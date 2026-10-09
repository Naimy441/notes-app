"use client";

import { useSyncExternalStore } from "react";
import type { Note, SortKey } from "./types";

/**
 * Notes you're actively editing keep the sort position they had when you started,
 * so the grid behind the editor (or under your finger) doesn't reshuffle on every
 * keystroke. Cleared when you switch views, which re-sorts everything normally.
 */
export type Frozen = ReadonlyMap<string, Pick<Note, "updatedAt" | "createdAt">>;

let frozen: Frozen = new Map();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

export function freeze(note: Note | undefined) {
  if (!note || frozen.has(note.id)) return;
  frozen = new Map(frozen).set(note.id, { updatedAt: note.updatedAt, createdAt: note.createdAt });
  notify();
}

export function clearFrozen() {
  if (!frozen.size) return;
  frozen = new Map();
  notify();
}

export function useFrozen(): Frozen {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => frozen,
    () => frozen,
  );
}

/**
 * While a note is open, the list keeps the title and body from when editing
 * started. Keystrokes show up in the editor only; the grid catches up once
 * the editor closes and the user is looking at the list again.
 */
export type HeldContent = { id: string; title: string; body: string; updatedAt: number; createdAt: number };

let held: HeldContent | null = null;

export function holdContent(note: Note | undefined) {
  if (!note || held?.id === note.id) return;
  held = { id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt, createdAt: note.createdAt };
  notify();
}

export function releaseContent() {
  if (!held) return;
  held = null;
  notify();
}

export function useHeld(): HeldContent | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => held,
    () => held,
  );
}

/** Title/body the list should render. Live edits stay in the editor. */
export function presentNote(note: Note, snap: HeldContent | null): Note {
  if (!snap || snap.id !== note.id) return note;
  if (note.title === snap.title && note.body === snap.body && note.updatedAt === snap.updatedAt) return note;
  return { ...note, title: snap.title, body: snap.body, updatedAt: snap.updatedAt, createdAt: snap.createdAt };
}

export const sortTime = (n: Note, key: SortKey, f?: Frozen) => f?.get(n.id)?.[key] ?? n[key];
