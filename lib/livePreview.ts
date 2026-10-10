/**
 * Obsidian-style "live preview" for CodeMirror 6: the note is always editable
 * Markdown, but formatting is shown in place. Markup characters (`**`, `##`,
 * `[](url)`, `> `, …) are hidden except on the line(s) the cursor is on, bullets
 * render as dots and task markers as real, tappable checkboxes.
 */
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, type Extension, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// ─── widgets ─────────────────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    // A real <input type="checkbox"> is a form control. iOS then offers it to
    // the keyboard's prev/next accessory while the note is focused. A span is
    // not an input, so it is not promoted.
    const box = document.createElement("span");
    box.className = this.checked ? "cm-task-box on" : "cm-task-box";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", this.checked ? "true" : "false");
    box.setAttribute("aria-label", this.checked ? "Mark not done" : "Mark done");
    // Don't move the cursor or raise the keyboard; just toggle.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const marker = view.state.sliceDoc(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});

type Align = "left" | "center" | "right";

class CodeWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly info: string,
  ) {
    super();
  }
  eq(other: CodeWidget) {
    return other.code === this.code && other.info === this.info;
  }
  toDOM() {
    const pre = document.createElement("pre");
    pre.className = "cm-rendered-code";
    if (this.info) {
      const lang = document.createElement("span");
      lang.className = "cm-code-lang";
      lang.textContent = this.info;
      pre.append(lang);
    }
    const code = document.createElement("code");
    code.textContent = this.code;
    pre.append(code);
    return pre;
  }
  ignoreEvent() {
    return false;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly header: string[],
    readonly rows: string[][],
    readonly align: Align[],
  ) {
    super();
  }
  eq(other: TableWidget) {
    return sameCells(other.header, this.header) && other.rows.length === this.rows.length && other.rows.every((row, i) => sameCells(row, this.rows[i])) && other.align.join() === this.align.join();
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    if (this.header.length) {
      const thead = document.createElement("thead");
      thead.append(tableRow("th", this.header, this.align));
      table.append(thead);
    }
    const body = document.createElement("tbody");
    for (const row of this.rows) body.append(tableRow("td", row, this.align));
    table.append(body);
    wrap.append(table);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function sameCells(a: string[], b: string[]) {
  return a.length === b.length && a.every((cell, i) => cell === b[i]);
}

function tableRow(tag: "th" | "td", cells: string[], align: Align[]) {
  const tr = document.createElement("tr");
  cells.forEach((text, i) => {
    const cell = document.createElement(tag);
    cell.textContent = text;
    cell.style.textAlign = align[i] ?? "left";
    tr.append(cell);
  });
  return tr;
}

function blockRange(doc: Text, from: number, to: number) {
  const start = doc.lineAt(from).from;
  const end = doc.lineAt(Math.max(from, to - 1)).to;
  return { from: start, to: Math.max(start, end) };
}

function selectionTouches(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function childText(node: SyntaxNode, state: EditorState, name: string) {
  let text = "";
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === name) text += state.sliceDoc(c.from, c.to);
  }
  return text.replace(/\n$/, "");
}

function tableCells(row: SyntaxNode, state: EditorState) {
  const cells: string[] = [];
  for (let c = row.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableCell") cells.push(state.sliceDoc(c.from, c.to).replace(/\s+/g, " ").trim());
  }
  return cells;
}

function tableAlign(text: string): Align[] {
  return text
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      return "left";
    });
}

function tableModel(node: SyntaxNode, state: EditorState) {
  let header: string[] = [];
  const rows: string[][] = [];
  let align: Align[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableHeader") header = tableCells(c, state);
    else if (c.name === "TableRow") rows.push(tableCells(c, state));
    else if (c.name === "TableDelimiter" && state.sliceDoc(c.from, c.to).includes("-")) align = tableAlign(state.sliceDoc(c.from, c.to));
  }
  return { header, rows, align };
}

// ─── decorations ─────────────────────────────────────────────────────────────

/** Lines the cursor/selection touches; markup stays visible there so it can be edited. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

const lineClass = (cls: string) => Decoration.line({ class: cls });
const WIKILINK = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

function build(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(view);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const covered: { from: number; to: number }[] = [];
  const cover = (from: number, to: number) => covered.push({ from, to });
  const insideCover = (from: number, to: number) => covered.some((r) => from < r.to && to > r.from);
  /** Hide [from,to) plus one following space, unless the cursor is on that line. */
  const hideMark = (from: number, to: number, withSpace = false) => {
    if (isActive(from)) return;
    if (withSpace && state.sliceDoc(to, to + 1) === " ") to++;
    if (to > from) out.push(hide.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          out.push(lineClass(`cm-h cm-h${heading[1]}`).range(doc.lineAt(node.from).from));
          return;
        }
        switch (name) {
          case "HeaderMark": {
            // "## " prefix, or a setext underline line.
            const line = doc.lineAt(node.from);
            if (node.from === line.from && /^[=-]+$/.test(state.sliceDoc(node.from, node.to)) && line.number > 1) {
              hideMark(node.from, node.to);
            } else hideMark(node.from, node.to, true);
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            hideMark(node.from, node.to);
            return;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode") hideMark(node.from, node.to);
            return;
          case "QuoteMark":
            hideMark(node.from, node.to, true);
            return;
          case "Blockquote": {
            for (let pos = node.from; pos <= node.to; ) {
              const line = doc.lineAt(pos);
              out.push(lineClass("cm-quote").range(line.from));
              pos = line.to + 1;
            }
            return;
          }
          case "FencedCode":
          case "CodeBlock":
          case "Table": {
            const range = blockRange(doc, node.from, node.to);
            if (!selectionTouches(view, range.from, range.to)) {
              // The rendered block comes from a state-field decoration. A view
              // plugin is not allowed to supply block widgets, and marks inside
              // the replaced lines would overlap that widget.
              cover(range.from, range.to);
              return false;
            }
            if (name === "FencedCode") {
              for (let pos = node.from; pos <= node.to; ) {
                const line = doc.lineAt(pos);
                out.push(lineClass("cm-codeblock").range(line.from));
                pos = line.to + 1;
              }
            }
            return false;
          }
          case "HorizontalRule": {
            const line = doc.lineAt(node.from);
            if (!active.has(line.number)) {
              out.push(lineClass("cm-hr").range(line.from));
              out.push(hide.range(node.from, node.to));
            }
            return;
          }
          case "ListMark": {
            const item = node.node.parent;
            const isTask = !!item?.getChild("Task");
            const mark = state.sliceDoc(node.from, node.to);
            if (isTask) hideMark(node.from, node.to, true);
            else if (/^[-*+]$/.test(mark) && !isActive(node.from)) out.push(bullet.range(node.from, node.to));
            return;
          }
          case "TaskMarker": {
            const checked = /x/i.test(state.sliceDoc(node.from + 1, node.from + 2));
            const deco = Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to);
            out.push(deco);
            atomic.push(deco);
            if (checked) {
              const end = doc.lineAt(node.from).to;
              if (end > node.to) out.push(Decoration.mark({ class: "cm-task-done" }).range(node.to, end));
            }
            return;
          }
          case "Link": {
            const url = node.node.getChild("URL");
            const marks = node.node.getChildren("LinkMark");
            // Only inline links "[text](url)"; reference-style and [[wikilinks]] are skipped.
            if (!url || marks.length < 2 || state.sliceDoc(node.from - 1, node.from) === "[") return false;
            const close = marks[1]; // the "]"
            const href = state.sliceDoc(url.from, url.to);
            if (close.from > node.from + 1) {
              out.push(Decoration.mark({ class: "cm-md-link", attributes: { "data-href": href } }).range(node.from + 1, close.from));
            }
            if (!isActive(node.from)) {
              out.push(hide.range(node.from, node.from + 1));
              out.push(hide.range(close.from, node.to));
            }
            return false;
          }
          case "URL": {
            // A bare link like https://example.com
            const href = state.sliceDoc(node.from, node.to);
            out.push(Decoration.mark({ class: "cm-md-link", attributes: { "data-href": href } }).range(node.from, node.to));
            return;
          }
        }
      },
    });

    // [[Wikilinks]] (not part of standard Markdown).
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (insideCover(start, end)) continue;
      const target = m[1].trim();
      const labelFrom = m[2] ? start + 2 + m[1].length + 1 : start + 2;
      const labelTo = end - 2;
      out.push(Decoration.mark({ class: "cm-wikilink", attributes: { "data-wikilink": target } }).range(labelFrom, labelTo));
      if (!isActive(start)) {
        out.push(hide.range(start, labelFrom));
        out.push(hide.range(labelTo, end));
      }
    }
  }
  return { decorations: Decoration.set(out, true), atomic: Decoration.set(atomic, true) };
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = build(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(u.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

// ─── links ───────────────────────────────────────────────────────────────────

/**
 * Tapping a rendered link opens it. On the line being edited (where the raw
 * Markdown is showing) a tap just places the cursor, so link text stays editable.
 */
function linkClicks(onWikilink: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-md-link, .cm-wikilink");
      if (!el || e.button !== 0) return false;
      const pos = view.posAtDOM(el);
      if (activeLines(view).has(view.state.doc.lineAt(pos).number) && !(e.metaKey || e.ctrlKey)) return false;
      e.preventDefault();
      if (el.dataset.wikilink) onWikilink(el.dataset.wikilink);
      else if (el.dataset.href) {
        const href = /^[a-z][a-z0-9+.-]*:/i.test(el.dataset.href) ? el.dataset.href : `https://${el.dataset.href}`;
        window.open(href, "_blank", "noopener,noreferrer");
      }
      return true;
    },
  });
}

// ─── look ────────────────────────────────────────────────────────────────────

export const markdownHighlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.9em" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--muted)" },
  { tag: t.quote, color: "var(--text-2)" },
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "transparent", fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.65", overflow: "visible" },
  ".cm-content": { padding: "4px 0 12px", caretColor: "var(--text)", minHeight: "30vh", overflowAnchor: "none" },
  // `dir` is set per line (see lib/editorKit.ts). Isolate so that attribute wins
  // over a document that also contains Arabic.
  ".cm-line": { padding: "0", unicodeBidi: "isolate", textAlign: "start" },
  ".cm-ar": { fontSize: "1.22em" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-h": { fontWeight: "700", letterSpacing: "-0.01em" },
  ".cm-h1": { fontSize: "1.45em", lineHeight: "1.35" },
  ".cm-h2": { fontSize: "1.25em", lineHeight: "1.4" },
  ".cm-h3": { fontSize: "1.1em" },
  ".cm-quote": { borderInlineStart: "3px solid var(--border-strong)", paddingInlineStart: "0.8em", color: "var(--muted)" },
  ".cm-codeblock": { fontFamily: "var(--mono)", fontSize: "0.88em", backgroundColor: "var(--field)", paddingInline: "10px" },
  ".cm-rendered-code": {
    fontFamily: "var(--mono)",
    fontSize: "0.85em",
    lineHeight: "1.45",
    backgroundColor: "var(--field)",
    padding: "10px 12px",
    borderRadius: "10px",
    margin: "0.35em 0 0.7em",
    overflowX: "auto",
    whiteSpace: "pre",
  },
  ".cm-rendered-code code": { fontFamily: "inherit", fontSize: "inherit", background: "none", padding: 0 },
  ".cm-code-lang": { display: "block", marginBottom: "6px", color: "var(--muted)", fontFamily: "var(--font)", fontSize: "11px", fontWeight: "650", letterSpacing: "0.04em", textTransform: "uppercase" },
  ".cm-md-table-wrap": { overflowX: "auto", margin: "0.45em 0 0.75em" },
  ".cm-md-table": { borderCollapse: "collapse", fontSize: "0.92em", width: "max-content", maxWidth: "100%" },
  ".cm-md-table th, .cm-md-table td": { border: "1px solid var(--border-strong)", padding: "4px 8px", verticalAlign: "top" },
  ".cm-md-table th": { fontWeight: "700" },
  ".cm-hr": { position: "relative" },
  ".cm-hr::after": { content: '""', position: "absolute", insetInline: "0", top: "50%", borderTop: "1px solid var(--border-strong)" },
  ".cm-bullet": { color: "var(--muted)", display: "inline-block", minWidth: "0.9em", fontWeight: "700" },
  ".cm-task-box": {
    appearance: "none",
    width: "1.05em",
    height: "1.05em",
    margin: "0 0.45em 0 0",
    verticalAlign: "-0.17em",
    borderRadius: "0.28em",
    border: "1.6px solid var(--muted)",
    cursor: "pointer",
    display: "inline-grid",
    placeItems: "center",
    transition: "background .15s, border-color .15s",
  },
  ".cm-task-box.on": { backgroundColor: "var(--accent)", borderColor: "var(--accent)" },
  ".cm-task-box.on::after": {
    content: '""',
    width: "0.3em",
    height: "0.55em",
    border: "solid var(--accent-ink)",
    borderWidth: "0 0.13em 0.13em 0",
    transform: "rotate(45deg)",
    marginTop: "-0.1em",
  },
  ".cm-task-done": { color: "var(--muted)", textDecoration: "line-through" },
  ".cm-md-link, .cm-wikilink": { color: "var(--link)", textDecoration: "underline", textUnderlineOffset: "2px", cursor: "pointer" },
  ".cm-wikilink": { textDecorationStyle: "dotted" },
});

function cursorInside(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** Tables and fenced code, drawn as blocks whenever the caret is outside them. */
function renderBlocks(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode" && node.name !== "CodeBlock" && node.name !== "Table") return;
      const range = blockRange(state.doc, node.from, node.to);
      if (range.to <= range.from || cursorInside(state, range.from, range.to)) return false;
      if (node.name === "Table") {
        const model = tableModel(node.node, state);
        out.push(Decoration.replace({ widget: new TableWidget(model.header, model.rows, model.align), block: true }).range(range.from, range.to));
      } else {
        const info = node.name === "FencedCode" ? childText(node.node, state, "CodeInfo").trim() : "";
        out.push(Decoration.replace({ widget: new CodeWidget(childText(node.node, state, "CodeText"), info), block: true }).range(range.from, range.to));
      }
      return false;
    },
  });
  return Decoration.set(out, true);
}

const renderedBlocks = StateField.define<DecorationSet>({
  create: renderBlocks,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? renderBlocks(tr.state) : deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function livePreview(opts: { onWikilink: (target: string) => void }): Extension {
  return [renderedBlocks, livePreviewPlugin, linkClicks(opts.onWikilink), theme];
}
