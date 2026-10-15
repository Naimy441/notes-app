/**
 * Find & replace inside the open note's CodeMirror editor: highlights every
 * match, tracks the current one, and replaces through normal transactions
 * (so ⌘Z undoes a replace like any edit). The bar itself is FindBar.tsx.
 */
import { EditorSelection, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { findAll, matchAt, replacementFor, type Match } from "./find";

export interface FindState {
  re: RegExp | null;
  regex: boolean;
  keepCase: boolean;
  matches: Match[];
  /** Index into `matches`, or -1 when no match is current. */
  current: number;
}

const EMPTY: FindState = { re: null, regex: false, keepCase: false, matches: [], current: -1 };

/** Search for `re` (null clears the search). */
export const setFindQuery = StateEffect.define<{ re: RegExp | null; regex: boolean; keepCase: boolean }>();
const setCurrent = StateEffect.define<number>();

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });

export const findField = StateField.define<FindState>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setFindQuery)) {
        const { re, regex, keepCase } = e.value;
        next = re ? { re, regex, keepCase, matches: findAll(tr.state.doc.toString(), re), current: -1 } : EMPTY;
      }
    }
    if (next === value && tr.docChanged && value.re) {
      // Re-run the search on the new text. The current match carries over to the
      // first match at or after where it was (after a replace: the next one).
      const matches = findAll(tr.state.doc.toString(), value.re);
      let current = -1;
      if (value.current >= 0 && matches.length) {
        const at = tr.changes.mapPos(value.matches[value.current].from, 1);
        current = matches.findIndex((m) => m.from >= at);
        if (current < 0) current = 0;
      }
      next = { ...value, matches, current };
    }
    for (const e of tr.effects) {
      if (e.is(setCurrent)) next = { ...next, current: e.value };
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (s): DecorationSet => {
      if (!s.matches.length) return Decoration.none;
      const ranges: Range<Decoration>[] = s.matches.map((m, i) => (i === s.current ? currentMark : matchMark).range(m.from, m.to));
      return Decoration.set(ranges);
    }),
});

// ─── telling the bar about changes ────────────────────────────────────────────

const listeners = new WeakMap<EditorView, () => void>();

/** Call `fn` whenever the search results or the current match change. */
export function onFindChange(view: EditorView, fn: () => void) {
  listeners.set(view, fn);
  return () => {
    if (listeners.get(view) === fn) listeners.delete(view);
  };
}

const notifier = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (u.startState.field(findField) !== u.state.field(findField)) {
        const view = u.view;
        queueMicrotask(() => listeners.get(view)?.());
      }
    }
  },
);

export function findInNote(): Extension {
  return [findField, notifier, findTheme];
}

// ─── commands ─────────────────────────────────────────────────────────────────

export const findState = (view: EditorView) => view.state.field(findField, false) ?? EMPTY;

/**
 * Keep the current match in view inside the note sheet, which (not
 * CodeMirror) is what scrolls. Centers it when it's outside the visible band.
 */
export function revealMatch(view: EditorView) {
  const s = findState(view);
  const m = s.matches[s.current];
  if (!m) return;
  requestAnimationFrame(() => {
    const scroller = view.dom.closest(".editor-scroll");
    const top = view.coordsAtPos(m.from, 1);
    const bottom = view.coordsAtPos(m.to, -1) ?? top;
    if (!(scroller instanceof HTMLElement) || !top || !bottom) return;
    const box = scroller.getBoundingClientRect();
    const margin = 48;
    if (top.top >= box.top + margin && bottom.bottom <= box.bottom - margin) return;
    const mid = (top.top + bottom.bottom) / 2;
    scroller.scrollTop += mid - (box.top + box.height / 2);
  });
}

/**
 * Make match `index` the current one. It also becomes the editor selection, so
 * the line shows its raw Markdown (and a rendered table or code block opens up)
 * when the match is inside formatting, and typing after closing the bar
 * continues from there.
 */
export function selectMatch(view: EditorView, index: number) {
  const s = findState(view);
  const m = s.matches[index];
  if (!m) return;
  view.dispatch({
    effects: setCurrent.of(index),
    selection: EditorSelection.single(m.from, m.to),
    userEvent: "select.search",
  });
  revealMatch(view);
}

/** Move to the next (dir 1) or previous (dir -1) match, wrapping around. */
export function stepMatch(view: EditorView, dir: 1 | -1) {
  const s = findState(view);
  const n = s.matches.length;
  if (!n) return;
  let i: number;
  if (s.current < 0) {
    // Start from the caret: the first match after it (or the last one before it).
    const head = view.state.selection.main.from;
    i = dir === 1 ? s.matches.findIndex((m) => m.from >= head) : s.matches.findLastIndex((m) => m.to <= head);
    if (i < 0) i = dir === 1 ? 0 : n - 1;
  } else {
    i = (s.current + dir + n) % n;
  }
  selectMatch(view, i);
}

/** Make the first match at or after the caret current (for a fresh query). */
export function selectNearest(view: EditorView, from = view.state.selection.main.from) {
  const s = findState(view);
  if (!s.matches.length) return;
  let i = s.matches.findIndex((m) => m.from >= from);
  if (i < 0) i = 0;
  selectMatch(view, i);
}

/** Replace the current match, then move to the next one. Returns false if nothing was replaced. */
export function replaceCurrent(view: EditorView, replacement: string): boolean {
  const s = findState(view);
  if (s.current < 0) {
    stepMatch(view, 1);
    return false;
  }
  const m = s.matches[s.current];
  const found = s.re && matchAt(view.state.doc.toString(), s.re, m.from);
  if (!found) return false;
  const insert = replacementFor(replacement, found, s);
  view.dispatch({ changes: { from: m.from, to: m.from + found[0].length, insert }, userEvent: "input.replace" });
  // The field moved "current" to the next match; select it.
  const after = findState(view);
  if (after.current >= 0) selectMatch(view, after.current);
  else view.dispatch({ selection: EditorSelection.cursor(m.from + insert.length) });
  return true;
}

/** Replace every match in one undoable step. Returns how many were replaced. */
export function replaceAll(view: EditorView, replacement: string): number {
  const s = findState(view);
  if (!s.re || !s.matches.length) return 0;
  const text = view.state.doc.toString();
  const changes = [];
  for (const m of findAll(text, s.re, Number.MAX_SAFE_INTEGER)) {
    const found = matchAt(text, s.re, m.from);
    if (found) changes.push({ from: m.from, to: m.to, insert: replacementFor(replacement, found, s) });
  }
  if (!changes.length) return 0;
  view.dispatch({ changes, userEvent: "input.replace.all" });
  return changes.length;
}

const findTheme = EditorView.baseTheme({
  ".cm-find-match": {
    backgroundColor: "var(--find-match)",
    borderRadius: "3px",
    boxShadow: "0 0 0 1px var(--find-match)",
  },
  ".cm-find-current": {
    backgroundColor: "var(--find-current)",
    boxShadow: "0 0 0 1px var(--find-current)",
    color: "var(--find-current-ink)",
  },
});
