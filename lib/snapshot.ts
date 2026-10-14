"use client";

import type { FolderDoc, Note } from "./types";

/**
 * A copy of the whole note list in one IndexedDB record, so the app can paint
 * the notes as soon as it starts. Firestore's own offline cache holds the same
 * data, but reading it back means scanning and decoding every document, which
 * takes a noticeable moment on a phone. One structured-clone read is quick.
 * Firestore's cache and the server still load behind it and win where they differ.
 */

const DB_NAME = "notes-snapshot";
const STORE = "kv";
const KEY = "state";
const VERSION = 1;

export interface Snapshot {
  v: number;
  notes: Note[];
  folders: FolderDoc[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("snapshot db blocked"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= open());

export async function readSnapshot(): Promise<Snapshot | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result as Snapshot | undefined;
      resolve(v && v.v === VERSION && Array.isArray(v.notes) && Array.isArray(v.folders) ? v : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function writeSnapshot(notes: Note[], folders: FolderDoc[]): Promise<void> {
  const d = await db();
  const value: Snapshot = { v: VERSION, notes, folders };
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Forget the copy (on sign-out, together with Firestore's cache). */
export async function clearSnapshot(): Promise<void> {
  const d = await db().catch(() => null);
  d?.close();
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
