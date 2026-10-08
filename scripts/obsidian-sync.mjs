#!/usr/bin/env node
/**
 * Two-way sync between an Obsidian vault and the Notes app's Firestore.
 *
 *   node scripts/obsidian-sync.mjs            one sync pass
 *   node scripts/obsidian-sync.mjs --watch    keep running: live sync both ways
 *   node scripts/obsidian-sync.mjs --install  run --watch in the background at login (launchd)
 *   node scripts/obsidian-sync.mjs --uninstall
 *
 * Env:
 *   NOTES_VAULT               vault path (default ~/Documents/Notes)
 *   NOTES_SYNC_KEY            service-account JSON (default ~/.config/notes-sync/service-account.json)
 *   FIRESTORE_EMULATOR_HOST   talk to the local emulator instead (no key needed)
 *
 * Model: every note is one Firestore doc in `notes/` (title, body, folder, pinned, archived,
 * deleted, createdAt, updatedAt, syncedAt, path, fm). A local state file remembers which file
 * each doc maps to and the content hash at last sync, so each side's changes are detected
 * independently. When both sides changed, the newer edit wins and the other is kept as a
 * "(conflict …)" copy. Deleted notes go to the vault's .trash folder, never unlinked.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import YAML from "yaml";

const PROJECT_ID = "note-d7ce7";
const HOME = os.homedir();
const VAULT = path.resolve(process.env.NOTES_VAULT ?? path.join(HOME, "Documents/Notes"));
const CONFIG_DIR = path.join(HOME, ".config/notes-sync");
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const STATE_FILE = path.join(CONFIG_DIR, EMULATOR ? "state-emulator.json" : "state.json");
const REPO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** Key lookup: $NOTES_SYNC_KEY, then ~/.config/notes-sync/, then a downloaded *-firebase-adminsdk-*.json in the repo root (gitignored). */
function findKey() {
  if (process.env.NOTES_SYNC_KEY) return process.env.NOTES_SYNC_KEY;
  const configured = path.join(CONFIG_DIR, "service-account.json");
  if (fs.existsSync(configured)) return configured;
  const local = fs.readdirSync(REPO_DIR).find((f) => /-firebase-adminsdk-.*\.json$/.test(f));
  return local ? path.join(REPO_DIR, local) : configured;
}
const KEY_FILE = findKey();
const LABEL = "com.notes-app.obsidian-sync";
const PLIST = path.join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ─── CLI: install / uninstall ────────────────────────────────────────────────

if (process.argv.includes("--install")) {
  const script = fileURLToPath(import.meta.url);
  const logFile = path.join(CONFIG_DIR, "sync.log");
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  fs.writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string><string>${esc(script)}</string><string>--watch</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>NOTES_VAULT</key><string>${esc(VAULT)}</string>
    <key>NOTES_SYNC_KEY</key><string>${esc(KEY_FILE)}</string>
  </dict>
  <key>WorkingDirectory</key><string>${esc(path.dirname(path.dirname(script)))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
</dict></plist>
`,
  );
  try {
    execFileSync("launchctl", ["unload", PLIST], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["load", PLIST]);
  console.log(`Installed background sync (${PLIST}).\nLogs: ${logFile}`);
  process.exit(0);
}
if (process.argv.includes("--uninstall")) {
  try {
    execFileSync("launchctl", ["unload", PLIST], { stdio: "ignore" });
  } catch {}
  fs.rmSync(PLIST, { force: true });
  console.log("Removed background sync.");
  process.exit(0);
}

// ─── Firestore ───────────────────────────────────────────────────────────────

if (!fs.existsSync(VAULT)) {
  console.error(`Vault not found: ${VAULT}`);
  process.exit(1);
}
if (!EMULATOR && !fs.existsSync(KEY_FILE)) {
  console.error(
    `Missing service-account key at ${KEY_FILE}\n` +
      `Download one: Firebase console → Project settings → Service accounts → Generate new private key,\n` +
      `then: mkdir -p ${CONFIG_DIR} && mv ~/Downloads/${PROJECT_ID}-*.json ${KEY_FILE}`,
  );
  process.exit(1);
}
initializeApp(EMULATOR ? { projectId: PROJECT_ID } : { credential: cert(JSON.parse(fs.readFileSync(KEY_FILE, "utf8"))), projectId: PROJECT_ID });
const db = getFirestore();
const notesCol = db.collection("notes");
const foldersCol = db.collection("folders");

// ─── vault <-> note mapping ──────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Google Keep's importer names untitled notes after their creation time. */
const UNTITLED_RE = new RegExp(`^(${MONTHS.join("|")}) \\d{1,2}, \\d{4}, \\d{1,2}\\.\\d{2} [AP]M( \\d+)?$`);

function dateName(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}.${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

const sanitize = (s) =>
  s
    .replace(/[/\\:]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();

const sha = (s) => createHash("sha1").update(s).digest("hex");

/**
 * Drop the "## Annotations" link-preview sections the Google Keep importer appended.
 * Removes from that heading up to the next heading of level 1–2, or the end of the note.
 */
function stripAnnotations(body) {
  if (!body.includes("## Annotations")) return body;
  const lines = body.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s+Annotations\s*$/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^#{1,2}\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}

function parseFile(rel, content) {
  let data = {};
  let body = content;
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (m) {
    try {
      data = YAML.parse(m[1]) ?? {};
      if (typeof data !== "object" || Array.isArray(data)) data = {};
      body = content.slice(m[0].length);
    } catch {
      data = {};
    }
  }
  const rawTags = data.tags ?? data.tag ?? [];
  const tags = (Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[,\s]+/)).map((t) => String(t).replace(/^#/, ""));
  const extra = { ...data };
  delete extra.tags;
  delete extra.tag;
  delete extra.pinned;
  delete extra.archived;
  const name = path.posix.basename(rel, ".md");
  const dir = path.posix.dirname(rel);
  return {
    title: UNTITLED_RE.test(name) ? "" : name,
    body: stripAnnotations(body.replace(/^(\r?\n)+/, "")),
    folder: dir === "." ? "" : dir,
    pinned: data.pinned === true || tags.includes("Keep/Pinned"),
    archived: data.archived === true || tags.includes("Keep/Archived"),
    fm: Object.keys(extra).length ? YAML.stringify(extra) : null,
  };
}

function serialize(n) {
  let extra = {};
  if (n.fm) {
    try {
      extra = YAML.parse(n.fm) ?? {};
    } catch {}
  }
  if (n.pinned) extra.pinned = true;
  if (n.archived) extra.archived = true;
  const head = Object.keys(extra).length ? `---\n${YAML.stringify(extra)}---\n\n` : "";
  return head + (n.body ?? "");
}

function desiredPath(n, currentRel) {
  const base = n.title?.trim()
    ? sanitize(n.title)
    : currentRel
      ? path.posix.basename(currentRel, ".md")
      : dateName(n.createdAt || Date.now());
  return path.posix.join(n.folder || "", `${base || "Untitled"}.md`);
}

// ─── local scan ──────────────────────────────────────────────────────────────

const statCache = new Map(); // rel -> { mtimeMs, size, hash, content }

function scanVault() {
  const files = new Map();
  const dirs = new Set();
  const walk = (absDir, relDir) => {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        dirs.add(rel);
        walk(abs, rel);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const st = fs.statSync(abs);
        let c = statCache.get(rel);
        if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
          const content = fs.readFileSync(abs, "utf8");
          c = { mtimeMs: st.mtimeMs, size: st.size, hash: sha(content), content };
          statCache.set(rel, c);
        }
        const birth = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
        files.set(rel, { ...c, mtime: Math.round(st.mtimeMs), birth: Math.round(birth) });
      }
    }
  };
  walk(VAULT, "");
  return { files, dirs };
}

// ─── state ───────────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastSync: 0, notes: {}, folders: [] };
  }
}
function saveState(s) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE_FILE);
}

// ─── file ops ────────────────────────────────────────────────────────────────

const abs = (rel) => path.join(VAULT, ...rel.split("/"));

function writeNoteFile(rel, content, mtimeMs) {
  const p = abs(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  const t = new Date(mtimeMs);
  fs.utimesSync(p, t, t);
  const st = fs.statSync(p);
  const hash = sha(content);
  statCache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash, content });
  return hash;
}

function trashFile(rel) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return;
  const trashDir = path.join(VAULT, ".trash");
  fs.mkdirSync(trashDir, { recursive: true });
  let dest = path.join(trashDir, path.basename(p));
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(trashDir, `${path.basename(p, ".md")} ${i}.md`);
  fs.renameSync(p, dest);
  statCache.delete(rel);
}

function removeEmptyDirs(rel) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return true;
  let empty = true;
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    if (ent.isDirectory() && !ent.name.startsWith(".")) {
      if (!removeEmptyDirs(`${rel}/${ent.name}`)) empty = false;
    } else if (ent.name !== ".DS_Store") empty = false;
  }
  if (empty) fs.rmSync(p, { recursive: true, force: true });
  return empty;
}

// ─── sync pass ───────────────────────────────────────────────────────────────

async function syncOnce() {
  const state = loadState();
  const t0 = Date.now();
  const stats = { pulled: 0, pushed: 0, created: 0, deleted: 0, trashed: 0, conflicts: 0, folders: 0 };

  const since = state.lastSync ? Timestamp.fromMillis(state.lastSync - 5000) : null;
  const [noteSnap, folderSnap] = await Promise.all([
    since ? notesCol.where("syncedAt", ">=", since).get() : notesCol.get(),
    since ? foldersCol.where("syncedAt", ">=", since).get() : foldersCol.get(),
  ]);
  let maxSync = state.lastSync;
  const { files: local, dirs: localDirs } = scanVault();

  const writer = db.bulkWriter();
  writer.onWriteError((err) => err.failedAttempts < 5);
  const push = (id, fields) => {
    stats.pushed++;
    writer.set(notesCol.doc(id), { ...fields, syncedAt: FieldValue.serverTimestamp() }, { merge: true });
  };

  // Paths currently claimed by a tracked note.
  const owner = new Map(Object.entries(state.notes).filter(([, s]) => s.path).map(([id, s]) => [s.path, id]));
  const uniquePath = (want, id) => {
    let p = want;
    for (let i = 2; (owner.has(p) && owner.get(p) !== id) || (!owner.has(p) && local.has(p)); i++) {
      p = want.replace(/\.md$/, ` ${i}.md`);
    }
    return p;
  };

  // 1. Remote → vault
  for (const doc of noteSnap.docs) {
    const r = doc.data();
    const id = doc.id;
    if (r.syncedAt) maxSync = Math.max(maxSync, r.syncedAt.toMillis());
    const s = state.notes[id];
    if (s && r.updatedAt <= s.updatedAt) continue; // already applied (often our own push echoing back)

    const curRel = s ? s.path : r.path && local.has(r.path) ? r.path : null;
    const cur = curRel ? local.get(curRel) : null;
    const remoteContent = serialize(r);

    if (!s && cur) {
      // No sync history (fresh state): adopt the existing file.
      owner.set(curRel, id);
      if (cur.hash === sha(remoteContent) || cur.mtime > r.updatedAt) {
        state.notes[id] = { path: curRel, hash: cur.hash === sha(remoteContent) ? cur.hash : "", updatedAt: r.updatedAt };
        continue; // identical, or local is newer and step 2 will push it
      }
    }
    const localDirty = s ? (s.path ? !cur || cur.hash !== s.hash : false) : false;

    if (r.deleted) {
      if (cur && localDirty && cur.mtime > r.updatedAt) continue; // edited locally after deletion: local wins
      if (curRel && cur) {
        trashFile(curRel);
        local.delete(curRel);
        owner.delete(curRel);
        stats.trashed++;
      }
      state.notes[id] = { path: null, hash: null, updatedAt: r.updatedAt };
      continue;
    }

    if (localDirty && cur && cur.mtime > r.updatedAt) continue; // local is newer; pushed below
    if (localDirty && cur) {
      // Both changed; remote is newer. Keep the local version as a conflict copy.
      const copy = uniquePath(curRel.replace(/\.md$/, ` (conflict ${new Date().toISOString().slice(0, 10)}).md`), null);
      writeNoteFile(copy, cur.content, cur.mtime);
      local.set(copy, { ...statCache.get(copy), mtime: cur.mtime, birth: cur.birth });
      stats.conflicts++;
    }

    const target = uniquePath(desiredPath(r, curRel), id);
    const hash = writeNoteFile(target, remoteContent, r.updatedAt || Date.now());
    if (curRel && curRel !== target && fs.existsSync(abs(curRel))) {
      fs.rmSync(abs(curRel));
      statCache.delete(curRel);
      local.delete(curRel);
    }
    if (curRel) owner.delete(curRel);
    owner.set(target, id);
    local.set(target, { ...statCache.get(target), mtime: r.updatedAt, birth: r.createdAt });
    state.notes[id] = { path: target, hash, updatedAt: r.updatedAt };
    if (r.path !== target) writer.update(notesCol.doc(id), { path: target });
    stats.pulled++;
  }

  // 2. Vault → remote
  const byPath = new Map(Object.entries(state.notes).filter(([, s]) => s.path).map(([id, s]) => [s.path, id]));
  const missing = new Map(
    Object.entries(state.notes)
      .filter(([, s]) => s.path && !local.has(s.path))
      .map(([id, s]) => [id, s]),
  );
  const missingByHash = new Map([...missing].map(([id, s]) => [s.hash, id]));

  for (const [rel, f] of local) {
    const id = byPath.get(rel);
    if (id) {
      const s = state.notes[id];
      if (f.hash === s.hash) continue;
      const updatedAt = Math.max(f.mtime, s.updatedAt + 1);
      push(id, { ...parseFile(rel, f.content), path: rel, deleted: false, updatedAt });
      state.notes[id] = { path: rel, hash: f.hash, updatedAt };
      continue;
    }
    const movedId = missingByHash.get(f.hash);
    if (movedId) {
      // Renamed or moved in Obsidian: same content under a new path.
      const s = state.notes[movedId];
      missing.delete(movedId);
      missingByHash.delete(f.hash);
      const updatedAt = s.updatedAt + 1;
      push(movedId, { ...parseFile(rel, f.content), path: rel, deleted: false, updatedAt });
      state.notes[movedId] = { path: rel, hash: f.hash, updatedAt };
      continue;
    }
    const newId = notesCol.doc().id;
    push(newId, { ...parseFile(rel, f.content), path: rel, deleted: false, createdAt: f.birth, updatedAt: f.mtime });
    state.notes[newId] = { path: rel, hash: f.hash, updatedAt: f.mtime };
    stats.created++;
  }

  for (const [id, s] of missing) {
    // Deleted in Obsidian.
    const updatedAt = Math.max(Date.now(), s.updatedAt + 1);
    push(id, { deleted: true, updatedAt });
    state.notes[id] = { path: null, hash: null, updatedAt };
    stats.deleted++;
  }

  // 3. Folders
  const known = new Set(state.folders);
  const remoteFolders = new Map();
  for (const doc of folderSnap.docs) {
    const f = doc.data();
    if (f.syncedAt) maxSync = Math.max(maxSync, f.syncedAt.toMillis());
    remoteFolders.set(f.path, f);
  }
  for (const [p, f] of remoteFolders) {
    if (!p) continue;
    if (f.deleted) {
      if (localDirs.has(p) && removeEmptyDirs(p)) {
        for (const d of [...localDirs]) if (d === p || d.startsWith(p + "/")) localDirs.delete(d);
        stats.folders++;
      }
    } else if (!localDirs.has(p)) {
      fs.mkdirSync(abs(p), { recursive: true });
      localDirs.add(p);
      stats.folders++;
    }
  }
  // Notes that moved out may leave their old folder empty — that's fine; it stays as a folder.
  for (const d of localDirs) {
    if (!known.has(d) && !remoteFolders.has(d)) {
      writer.set(foldersCol.doc(encodeURIComponent(d)), { path: d, deleted: false, updatedAt: Date.now(), syncedAt: FieldValue.serverTimestamp() });
      stats.folders++;
    }
  }
  for (const d of known) {
    if (!localDirs.has(d) && !remoteFolders.get(d)?.deleted) {
      writer.set(foldersCol.doc(encodeURIComponent(d)), { path: d, deleted: true, updatedAt: Date.now(), syncedAt: FieldValue.serverTimestamp() });
      stats.folders++;
    }
  }
  state.folders = [...localDirs].sort();

  await writer.close();
  state.lastSync = maxSync;
  saveState(state);

  const changed = Object.entries(stats).filter(([, v]) => v);
  if (changed.length) log(`synced in ${Date.now() - t0}ms:`, changed.map(([k, v]) => `${v} ${k}`).join(", "));
  return stats;
}

// ─── run ─────────────────────────────────────────────────────────────────────

let running = null;
let again = false;
async function schedule() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await syncOnce();
      } catch (e) {
        log("sync failed:", e.message ?? e);
      }
    } while (again);
  })();
  await running;
  running = null;
}

if (!process.argv.includes("--watch")) {
  log(`syncing ${VAULT} ⇄ ${EMULATOR ? "emulator" : PROJECT_ID}`);
  await schedule();
  process.exit(0);
}

log(`watching ${VAULT} ⇄ ${EMULATOR ? "emulator" : PROJECT_ID}`);
await schedule();

let fsTimer;
fs.watch(VAULT, { recursive: true }, (_evt, file) => {
  if (!file || file.split(path.sep).some((part) => part.startsWith("."))) return;
  clearTimeout(fsTimer);
  fsTimer = setTimeout(schedule, 1200);
});

let remoteTimer;
const onRemote = (snap) => {
  if (!snap.docChanges().length) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(schedule, 400);
};
const now = Timestamp.now();
notesCol.where("syncedAt", ">", now).onSnapshot(onRemote, (e) => log("listener error:", e.message));
foldersCol.where("syncedAt", ">", now).onSnapshot(onRemote, (e) => log("listener error:", e.message));

// Belt and braces: a periodic pass catches anything a watcher missed (sleep, network drops).
setInterval(schedule, 5 * 60 * 1000);
