/**
 * Editor behavior that CodeMirror's stock bidi handling gets wrong once a
 * document has contained Arabic: line direction, taps in the empty tail of an
 * LTR line, and backspace leaving the caret on the wrong side of the text.
 */
import { findClusterBreak, EditorSelection, EditorState, Prec, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { ARABIC_RUN, lineDir } from "./bidi";

const lineDeco = {
  ltr: Decoration.line({ attributes: { dir: "ltr" } }),
  rtl: Decoration.line({ attributes: { dir: "rtl" } }),
};
const arabicMark = Decoration.mark({ class: "cm-ar" });

function layoutDecos(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let prev: "ltr" | "rtl" = "ltr";
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const dir = lineDir(line.text, prev);
    if (line.text.trim()) prev = dir;
    ranges.push(lineDeco[dir].range(line.from));
    ARABIC_RUN.lastIndex = 0;
    for (const m of line.text.matchAll(ARABIC_RUN)) {
      const from = line.from + (m.index ?? 0);
      ranges.push(arabicMark.range(from, from + m[0].length));
    }
  }
  return Decoration.set(ranges, true);
}

/** Explicit per-line `dir`, plus a slightly larger size for Arabic letters. */
export function bidiLayout(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = layoutDecos(view.state);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = layoutDecos(u.view.state);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function lineElementAt(view: EditorView, x: number, y: number): { el: HTMLElement; from: number } | null {
  const hit = view.posAtCoords({ x, y }, false);
  if (hit == null) return null;
  const line = view.state.doc.lineAt(hit);
  const dom = view.domAtPos(line.from);
  const node = dom.node.nodeType === 1 ? (dom.node as HTMLElement) : dom.node.parentElement;
  const el = node?.closest(".cm-line");
  if (!(el instanceof HTMLElement)) return null;
  return { el, from: line.from };
}

/** Right edge of the text on the visual row under `y` (LTR lines grow to the right). */
function rowEndX(el: HTMLElement, y: number): number | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const row = rects.filter((r) => y >= r.top - 2 && y <= r.bottom + 2);
  const use = row.length ? row : rects;
  return Math.max(...use.map((r) => r.right));
}

/**
 * A tap in the blank area past the end of an LTR line belongs at the end of
 * that line. Stock hit-testing maps that spot to offset 0 once the document
 * has an RTL base direction, while typed text still lands at the end.
 */
function placeAtLtrTail(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  const found = lineElementAt(view, event.clientX, event.clientY);
  if (!found) return false;
  const line = view.state.doc.lineAt(found.from);
  if (!line.text.length || lineDir(line.text) !== "ltr") return false;
  const edge = rowEndX(found.el, event.clientY);
  if (edge == null || event.clientX <= edge + 3) return false;
  const box = found.el.getBoundingClientRect();
  if (event.clientY < box.top || event.clientY > box.bottom) return false;
  event.preventDefault();
  view.dispatch({
    selection: EditorSelection.cursor(line.to, -1),
    userEvent: "select.pointer",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function bidiHitTest(): Extension {
  return EditorView.domEventHandlers({
    mousedown: placeAtLtrTail,
  });
}

/**
 * Backspace at the end of an LTR line deletes the last character and stays
 * after the new end. Backspace at the start joins with the previous line and
 * stays after that line's last character, not on its first.
 */
function bidiBackspace(view: EditorView): boolean {
  const sel = view.state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return false;
  const head = sel.main.head;
  const line = view.state.doc.lineAt(head);
  if (lineDir(line.text) !== "ltr") return false;
  // Leave list markers, quotes, and heading marks to the Markdown keymap.
  if (/^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?|#{1,6}\s*)$/.test(line.text)) return false;

  if (head === line.to && line.text.length > 0) {
    const rel = findClusterBreak(line.text, line.text.length, false);
    const from = line.from + rel;
    if (from >= line.to) return false;
    view.dispatch({
      changes: { from, to: line.to },
      selection: EditorSelection.cursor(from, -1),
      userEvent: "delete.backward",
      scrollIntoView: true,
    });
    return true;
  }

  if (head === line.from && line.number > 1) {
    const prev = view.state.doc.line(line.number - 1);
    view.dispatch({
      changes: { from: prev.to, to: line.from },
      selection: EditorSelection.cursor(prev.to, -1),
      userEvent: "delete.backward",
      scrollIntoView: true,
    });
    return true;
  }
  return false;
}

export function bidiKeys(): Extension {
  return Prec.highest(keymap.of([
    { key: "Backspace", run: bidiBackspace },
    { key: "Shift-Backspace", run: bidiBackspace },
  ]));
}

/** A little space above the caret, and room for the next line underneath. */
function caretBand() {
  const mobile = window.innerWidth < 700;
  return { top: mobile ? 16 : 28, bottom: mobile ? 72 : 88 };
}

export function readingRoom(): Extension {
  return EditorView.scrollMargins.of(() => caretBand());
}

/**
 * Nudge the sheet's scroller only when the caret would leave the visible band.
 * A caret that is already on screen stays where it is.
 */
export function scrollCaretIntoView(view: EditorView | null) {
  if (!view) return;
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head, -1) ?? view.coordsAtPos(head, 1);
  if (!coords) return;
  const scroller = view.dom.closest(".editor-scroll");
  if (!(scroller instanceof HTMLElement)) return;
  const rect = scroller.getBoundingClientRect();
  const { top, bottom } = caretBand();
  const below = rect.bottom - bottom;
  const above = rect.top + top;
  if (coords.bottom > below) scroller.scrollTop += coords.bottom - below;
  else if (coords.top < above) scroller.scrollTop -= above - coords.top;
}
