"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { bidiHitTest, bidiKeys, bidiLayout, readingRoom, scrollCaretIntoView } from "@/lib/editorKit";
import { dictationField } from "@/lib/dictationEditor";
import { livePreview, markdownHighlight } from "@/lib/livePreview";

let applyBodyEditable: (on: boolean) => void = () => {};

/**
 * Turn the note body into a form control, or take it back out.
 * CodeMirror rewrites `contenteditable` on every update, so setting the
 * attribute from outside does not stick. Reconfiguring the editable facet
 * makes CodeMirror itself write the value it will keep.
 */
export function setBodyEditable(on: boolean) {
  applyBodyEditable(on);
}

export type EditSurface = "title" | "body" | "none";

/**
 * Which note surface currently has an editable style.
 * WebKit's inputTypeForElement promotes every element with hasEditableStyle()
 * to InputType::ContentEditable, and isAssistableElement walks those for the
 * accessory arrows. The title and the body must not both be editable.
 */
let surface: EditSurface = "none";
const surfaceListeners = new Set<() => void>();

export function setEditSurface(next: EditSurface) {
  // Every touch arms a surface. Reconfiguring CodeMirror when nothing changed
  // costs a full editor update in the middle of the gesture.
  if (next === surface) return;
  surface = next;
  setBodyEditable(next === "body");
  surfaceListeners.forEach((fn) => fn());
}

export function useEditSurface(): EditSurface {
  return useSyncExternalStore(
    (cb) => {
      surfaceListeners.add(cb);
      return () => surfaceListeners.delete(cb);
    },
    () => surface,
    () => "none",
  );
}

interface Props {
  initial: string;
  onChange: (text: string) => void;
  onWikilink: (target: string) => void;
  onModEnter: () => void;
  onReady: (view: EditorView | null) => void;
}

type Callbacks = Pick<Props, "onChange" | "onWikilink" | "onModEnter">;

/** Everything the note body is made of. `cb` is read at call time, so it can change under a live editor. */
function bodyExtensions(editable: Compartment, cb: Callbacks): Extension[] {
  return [
    editable.of(EditorView.editable.of(false)),
    history(),
    bidiKeys(),
    keymap.of([
      { key: "Mod-Enter", run: () => (cb.onModEnter(), true) },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    // GFM: task lists, strikethrough, bare-URL autolinks. Its keymap continues
    // lists/checklists on Enter and removes empty markers on Backspace.
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(markdownHighlight),
    livePreview({ onWikilink: (t) => cb.onWikilink(t) }),
    dictationField,
    bidiLayout(),
    bidiHitTest(),
    readingRoom(),
    EditorView.lineWrapping,
    // Each line picks its own direction, so Arabic lines read right-to-left.
    EditorView.perLineTextDirection.of(true),
    EditorView.editorAttributes.of({ spellcheck: "false" }),
    EditorView.contentAttributes.of({
      dir: "ltr",
      autocapitalize: "sentences",
      autocorrect: "off",
      spellcheck: "false",
      "data-gramm": "false",
      "data-gramm_editor": "false",
      "data-enable-grammarly": "false",
      "aria-label": "Note",
    }),
    placeholder("Note"),
    EditorView.updateListener.of((u) => {
      const remote = u.transactions.every((tr) => tr.annotation(Transaction.remote));
      if ((u.docChanged || u.selectionSet) && !remote) {
        // CodeMirror's own scroller does not scroll the sheet. One frame
        // later, move the sheet only if the caret has left the visible band.
        const view = u.view;
        requestAnimationFrame(() => scrollCaretIntoView(view));
      }
      if (!u.docChanged || remote) return;
      // Edits pulled in from another device aren't the user's typing; don't save them back.
      cb.onChange(u.state.doc.toString());
    }),
  ];
}

/**
 * Build and throw away one editor while the app is idle. The first note you
 * open otherwise pays for loading CodeMirror's styles and warming up the parser
 * and the editor code, which makes that first open visibly slower than the rest.
 */
export function prewarmEditor() {
  if (typeof document === "undefined") return;
  const parent = document.createElement("div");
  parent.className = "note-body";
  parent.setAttribute("aria-hidden", "true");
  parent.style.cssText = "position:fixed;left:-10000px;top:0;width:360px;visibility:hidden;pointer-events:none";
  document.body.append(parent);
  const noop = () => {};
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "# Title\n\nSome **bold**, *italic* and `code` with a [link](https://example.com) and [[Note]].\n\n- item\n- [ ] task\n- [x] done\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nمرحبا بالعالم\n",
      extensions: bodyExtensions(new Compartment(), { onChange: noop, onWikilink: noop, onModEnter: noop }),
    }),
  });
  requestAnimationFrame(() => {
    view.destroy();
    parent.remove();
  });
}

/**
 * The note body: one always-editable CodeMirror editor with live preview, so a tap
 * puts the cursor exactly there (no separate view/edit modes).
 */
export function NoteBody({ initial, onChange, onWikilink, onModEnter, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-creating the editor.
  const cb = useRef({ onChange, onWikilink, onModEnter });
  useEffect(() => {
    cb.current = { onChange, onWikilink, onModEnter };
  });

  useLayoutEffect(() => {
    const editable = new Compartment();
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: bodyExtensions(editable, {
          onChange: (text) => cb.current.onChange(text),
          onWikilink: (t) => cb.current.onWikilink(t),
          onModEnter: () => cb.current.onModEnter(),
        }),
      }),
    });
    applyBodyEditable = (on) => {
      view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(on)) });
    };
    onReady(view);
    return () => {
      applyBodyEditable = () => {};
      onReady(null);
      view.destroy();
    };
    // The editor is created once per note; later text arrives through the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="note-body" dir="ltr" />;
}

/** Replace the whole document with text from elsewhere (another device), keeping the cursor if possible. */
export function setRemoteText(view: EditorView, text: string) {
  if (view.state.doc.toString() === text) return;
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
  });
}
