/**
 * CodeMirror side of dictation: where spoken text goes, and a grey preview of
 * words that are still being recognized.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

interface DictationState {
  /** Where the next phrase is inserted; follows edits made around it. */
  anchor: number;
  /**
   * Start of the first committed phrase this session. -1 until something is
   * written. Maps with document edits so a later "fix speech" can find it.
   */
  spanFrom: number;
  /** Start the first phrase on a new line (dictating into a note you weren't editing). */
  newLine: boolean;
  interim: string;
}

const begin = StateEffect.define<{ anchor: number; newLine: boolean }>();
const interim = StateEffect.define<string>();
const end = StateEffect.define<null>();
/** After a phrase lands: keep spanFrom, move the insert anchor. */
const advance = StateEffect.define<{ spanFrom: number; anchor: number }>();

class InterimWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: InterimWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-dictation-interim";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const field = StateField.define<DictationState | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    if (next && tr.docChanged) {
      next = {
        ...next,
        anchor: tr.changes.mapPos(next.anchor, 1),
        spanFrom: next.spanFrom < 0 ? -1 : tr.changes.mapPos(next.spanFrom, 1),
      };
    }
    for (const e of tr.effects) {
      if (e.is(begin)) next = { anchor: e.value.anchor, spanFrom: -1, newLine: e.value.newLine, interim: "" };
      else if (e.is(interim) && next) next = { ...next, interim: e.value };
      else if (e.is(advance) && next) next = { ...next, spanFrom: e.value.spanFrom, anchor: e.value.anchor, newLine: false, interim: "" };
      else if (e.is(end)) next = null;
    }
    return next;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (s) => {
      if (!s || !s.interim.trim()) return Decoration.none;
      return Decoration.set([Decoration.widget({ widget: new InterimWidget(s.interim), side: 1 }).range(s.anchor)]);
    }),
});

export const dictationField: Extension = field;

/** Start a session: at the cursor when editing, otherwise appended on a new line. */
export function beginDictation(view: EditorView) {
  const doc = view.state.doc;
  const editing = view.hasFocus;
  const anchor = editing ? view.state.selection.main.head : doc.length;
  const lastLine = doc.line(doc.lines).text;
  view.dispatch({ effects: begin.of({ anchor, newLine: !editing && lastLine.trim().length > 0 }) });
}

export function endDictation(view: EditorView) {
  if (view.state.field(field, false)) view.dispatch({ effects: end.of(null) });
}

/**
 * Range of text committed during the current dictation session, if any.
 * Call before endDictation — ending clears the session state.
 */
export function dictationSpan(view: EditorView): { from: number; to: number } | null {
  const s = view.state.field(field, false);
  if (!s || s.spanFrom < 0 || s.anchor <= s.spanFrom) return null;
  const from = Math.max(0, Math.min(s.spanFrom, view.state.doc.length));
  const to = Math.max(from, Math.min(s.anchor, view.state.doc.length));
  if (to <= from) return null;
  return { from, to };
}

export function showInterim(view: EditorView, text: string) {
  const s = view.state.field(field, false);
  if (!s) return;
  const shown = text ? spaced(view, s, text.trim(), false) : "";
  if (shown !== s.interim) view.dispatch({ effects: interim.of(shown) });
}

const SENTENCE_END = /[.!?؟]["'”’)\]]*\s*$/;
const LIST_PREFIX = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|#{1,6}\s+)?$/;

/** The phrase with a joining space and a capital where a sentence starts. */
function spaced(view: EditorView, s: DictationState, phrase: string, commit: boolean): string {
  const doc = view.state.doc;
  const at = s.anchor;
  let prefix = "";
  if (s.newLine && commit) prefix = "\n";
  const line = doc.lineAt(at);
  const before = s.newLine ? "" : doc.sliceString(line.from, at);
  const startOfLine = LIST_PREFIX.test(before);
  const startOfSentence = startOfLine || SENTENCE_END.test(before);
  let text = phrase;
  if (startOfSentence) text = text.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  if (!startOfLine && before && !/\s$/.test(before) && !/^[,.;:!?،؛)\]]/.test(text)) prefix += " ";
  const after = doc.sliceString(at, Math.min(doc.length, at + 1));
  if (after && !/\s/.test(after) && !/^[,.;:!?،؛)\]]/.test(after)) text += " ";
  return prefix + text;
}

/** Insert a finished phrase at the dictation anchor. */
export function insertPhrase(view: EditorView, phrase: string) {
  const s = view.state.field(field, false);
  const clean = phrase.replace(/\s+/g, " ").trim();
  if (!s || !clean) return;
  const insert = spaced(view, s, clean, true);
  const pos = s.anchor;
  const spanFrom = s.spanFrom >= 0 ? s.spanFrom : pos;
  view.dispatch({
    changes: { from: pos, insert },
    effects: [advance.of({ spanFrom, anchor: pos + insert.length })],
    selection: view.hasFocus ? { anchor: pos + insert.length } : undefined,
    scrollIntoView: view.hasFocus,
    userEvent: "input.dictate",
  });
}

/**
 * Scroll the dictation point into view. Works even when it's far off screen,
 * where CodeMirror hasn't drawn the line yet (so it has no coordinates).
 */
export function revealDictation(view: EditorView) {
  const s = view.state.field(field, false);
  if (!s) return;
  const pos = Math.min(s.anchor, view.state.doc.length);
  const at = view.coordsAtPos(pos, -1);
  const box = view.dom.closest(".editor-scroll")?.getBoundingClientRect();
  if (at && box && at.top >= box.top + 8 && at.bottom <= box.bottom - 72) return;
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 80 }) });
}
