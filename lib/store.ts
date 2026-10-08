"use client";

import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocFromCache,
  getDocsFromCache,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  waitForPendingWrites,
  where,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { useSyncExternalStore } from "react";
import { getDb } from "./firebase";
import type { FolderDoc, Note } from "./types";

export interface StoreState {
  notes: Map<string, Note>;
  folders: Map<string, FolderDoc>;
  /** Local (IndexedDB) cache has been read. */
  cacheLoaded: boolean;
  /** First server snapshot has arrived this session. */
  serverSynced: boolean;
  /** Writes not yet acknowledged by the server. */
  pending: number;
  online: boolean;
  error: string | null;
  version: number;
}

let state: StoreState = {
  notes: new Map(),
  folders: new Map(),
  cacheLoaded: false,
  serverSynced: false,
  pending: 0,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  error: null,
  version: 0,
};

const listeners = new Set<() => void>();
let emitQueued = false;

function emit() {
  // Coalesce bursts (e.g. a snapshot with 1000 docs) into one render.
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    state = { ...state, version: state.version + 1 };
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState() {
  return state;
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

let maxNoteSync = 0;
let maxFolderSync = 0;

function toMillis(v: unknown): number {
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  return 0;
}

function ingestNote(snap: DocumentSnapshot) {
  const d = snap.data({ serverTimestamps: "estimate" });
  if (!d) return;
  const incoming: Note = {
    id: snap.id,
    title: d.title ?? "",
    body: d.body ?? "",
    folder: d.folder ?? "",
    pinned: !!d.pinned,
    archived: !!d.archived,
    deleted: !!d.deleted,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
    path: d.path ?? null,
    fm: d.fm ?? null,
  };
  if (!snap.metadata.hasPendingWrites) maxNoteSync = Math.max(maxNoteSync, toMillis(d.syncedAt));
  const existing = state.notes.get(snap.id);
  // Last writer wins; never clobber a newer local edit with an older echo.
  if (existing && existing.updatedAt > incoming.updatedAt) return;
  state.notes.set(snap.id, incoming);
}

function ingestFolder(snap: DocumentSnapshot) {
  const d = snap.data({ serverTimestamps: "estimate" });
  if (!d) return;
  if (!snap.metadata.hasPendingWrites) maxFolderSync = Math.max(maxFolderSync, toMillis(d.syncedAt));
  const existing = state.folders.get(snap.id);
  const updatedAt = toMillis(d.updatedAt);
  if (existing && existing.updatedAt > updatedAt) return;
  state.folders.set(snap.id, { id: snap.id, path: d.path ?? "", deleted: !!d.deleted, updatedAt });
}

let cachePromise: Promise<void> | null = null;

/** Paint from the on-device cache. Safe to call before auth resolves. */
export function loadCache() {
  if (!cachePromise) {
    cachePromise = (async () => {
      const db = getDb();
      try {
        const [ns, fs] = await Promise.all([
          getDocsFromCache(collection(db, "notes")),
          getDocsFromCache(collection(db, "folders")),
        ]);
        ns.forEach(ingestNote);
        fs.forEach(ingestFolder);
      } catch (e) {
        console.warn("cache read failed", e);
      }
      state.cacheLoaded = true;
      emit();
    })();
  }
  return cachePromise;
}

let unsubs: Unsubscribe[] = [];

/** Start realtime sync. Only fetches docs changed since the newest one cached. */
export async function startSync() {
  if (unsubs.length) return;
  await loadCache();
  const db = getDb();

  const onError = (e: Error) => {
    console.error(e);
    state.error = e.message;
    emit();
  };

  // A small overlap guards against docs committed in the same instant.
  const noteSince = Timestamp.fromMillis(Math.max(0, maxNoteSync - 2000));
  const folderSince = Timestamp.fromMillis(Math.max(0, maxFolderSync - 2000));

  unsubs.push(
    onSnapshot(
      query(collection(db, "notes"), where("syncedAt", ">=", noteSince)),
      // Metadata changes tell us when the server has confirmed the (possibly empty) delta.
      { includeMetadataChanges: true },
      (snap) => {
        let changed = false;
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") continue; // soft deletes only; "removed" = left the query
          if (ch.doc.metadata.hasPendingWrites) continue; // our own optimistic echo
          ingestNote(ch.doc);
          changed = true;
        }
        if (!snap.metadata.fromCache && !state.serverSynced) {
          state.serverSynced = true;
          changed = true;
        }
        if (state.error) {
          state.error = null;
          changed = true;
        }
        if (changed) emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, "folders"), where("syncedAt", ">=", folderSince)),
      (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed" || ch.doc.metadata.hasPendingWrites) continue;
          ingestFolder(ch.doc);
        }
        emit();
      },
      onError,
    ),
  );

  // Writes queued in a previous session (e.g. made offline) still count as pending.
  trackPending(waitForPendingWrites(db));

  reconcile("notes", state.notes, ingestNote).catch((e) => console.warn("reconcile notes", e));
  reconcile("folders", state.folders, ingestFolder).catch((e) => console.warn("reconcile folders", e));
}

/**
 * The delta listener only sees documents that still exist, so a hard delete on the
 * server (e.g. a re-import) would leave ghosts in the device cache forever.
 * Compare counts (one cheap aggregate read); only on a mismatch, fetch the full
 * collection — which also makes Firestore evict the missing docs from its cache.
 */
async function reconcile(name: "notes" | "folders", map: Map<string, unknown>, ingest: (s: DocumentSnapshot) => void) {
  const db = getDb();
  const col = collection(db, name);
  const serverCount = (await getCountFromServer(col)).data().count;
  if (serverCount === map.size) return;
  const snap = await getDocsFromServer(col);
  const live = new Set(snap.docs.map((d) => d.id));
  let changed = false;
  for (const id of [...map.keys()]) {
    if (live.has(id) || writeTimers.has(id)) continue;
    // Keep notes created offline that haven't reached the server yet.
    const cached = await getDocFromCache(doc(db, name, id)).catch(() => null);
    if (cached?.metadata.hasPendingWrites) continue;
    map.delete(id);
    changed = true;
  }
  snap.docs.forEach((d) => {
    if (!map.has(d.id)) {
      ingest(d);
      changed = true;
    }
  });
  if (changed) emit();
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

function trackPending(p: Promise<unknown>) {
  state.pending++;
  emit();
  p.catch((e) => {
    console.error(e);
    state.error = e?.message ?? String(e);
  }).finally(() => {
    state.pending--;
    emit();
  });
}

if (typeof window !== "undefined") {
  const setOnline = () => {
    state.online = navigator.onLine;
    emit();
  };
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOnline);
  // Don't lose debounced edits when the app is backgrounded or closed.
  const flushAll = () => [...writeTimers.keys()].forEach(flushNote);
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushNote(id: string) {
  const t = writeTimers.get(id);
  if (t) clearTimeout(t);
  writeTimers.delete(id);
  const n = state.notes.get(id);
  if (!n) return;
  // `path` and `fm` belong to the Obsidian sync script; merge leaves them intact.
  trackPending(
    setDoc(
      doc(getDb(), "notes", id),
      {
        title: n.title,
        body: n.body,
        folder: n.folder,
        pinned: n.pinned,
        archived: n.archived,
        deleted: n.deleted,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        syncedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  );
}

function scheduleWrite(id: string, delay: number) {
  const t = writeTimers.get(id);
  if (t) clearTimeout(t);
  if (delay <= 0) return flushNote(id);
  writeTimers.set(id, setTimeout(() => flushNote(id), delay));
}

export function newNoteId() {
  return doc(collection(getDb(), "notes")).id;
}

export function createNote(id: string, fields: Partial<Note>) {
  const now = Date.now();
  const n: Note = {
    id,
    title: "",
    body: "",
    folder: "",
    pinned: false,
    archived: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  state.notes.set(id, n);
  emit();
  scheduleWrite(id, 400);
  return n;
}

/** Text edits are debounced; structural changes (pin, move, delete) write immediately. */
export function updateNote(id: string, patch: Partial<Note>, opts: { debounce?: boolean; touch?: boolean } = {}) {
  const n = state.notes.get(id);
  if (!n) return;
  const touch = opts.touch ?? true;
  state.notes.set(id, { ...n, ...patch, updatedAt: touch ? Date.now() : n.updatedAt + 1 });
  emit();
  scheduleWrite(id, opts.debounce ? 500 : 0);
}

export function flushPending(id: string) {
  if (writeTimers.has(id)) flushNote(id);
}

export function discardNote(id: string) {
  const t = writeTimers.get(id);
  if (t) clearTimeout(t);
  writeTimers.delete(id);
  const n = state.notes.get(id);
  state.notes.delete(id);
  emit();
  // Only touch the server if it might have been written already.
  if (n && !t) trackPending(deleteDoc(doc(getDb(), "notes", id)));
}

export function purgeNotes(ids: string[]) {
  for (const id of ids) {
    const t = writeTimers.get(id);
    if (t) clearTimeout(t);
    writeTimers.delete(id);
    state.notes.delete(id);
    trackPending(deleteDoc(doc(getDb(), "notes", id)));
  }
  emit();
}

// --- folders ----------------------------------------------------------------

const folderId = (path: string) => encodeURIComponent(path);

function writeFolder(path: string, deleted: boolean) {
  const id = folderId(path);
  const f: FolderDoc = { id, path, deleted, updatedAt: Date.now() };
  state.folders.set(id, f);
  trackPending(
    setDoc(doc(getDb(), "folders", id), { path, deleted, updatedAt: f.updatedAt, syncedAt: serverTimestamp() }),
  );
}

export function createFolder(path: string) {
  writeFolder(path, false);
  emit();
}

const within = (p: string, root: string) => p === root || p.startsWith(root + "/");

export function renameFolder(from: string, to: string) {
  if (from === to || within(to, from)) return;
  for (const f of [...state.folders.values()]) {
    if (!f.deleted && within(f.path, from)) {
      writeFolder(f.path, true);
      writeFolder(to + f.path.slice(from.length), false);
    }
  }
  writeFolder(to, false);
  for (const n of state.notes.values()) {
    if (within(n.folder, from)) updateNote(n.id, { folder: to + n.folder.slice(from.length) }, { touch: false });
  }
  emit();
}

export function deleteFolder(path: string) {
  for (const f of [...state.folders.values()]) {
    if (!f.deleted && within(f.path, path)) writeFolder(f.path, true);
  }
  for (const n of state.notes.values()) {
    if (!n.deleted && within(n.folder, path)) updateNote(n.id, { deleted: true });
  }
  emit();
}
