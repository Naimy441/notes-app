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

export const sortTime = (n: Note, key: SortKey, f?: Frozen) => f?.get(n.id)?.[key] ?? n[key];
