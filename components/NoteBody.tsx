"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { bidiHitTest, bidiKeys, bidiLayout, readingRoom, scrollCaretIntoView } from "@/lib/editorKit";
import { livePreview, markdownHighlight } from "@/lib/livePreview";

interface Props {
  initial: string;
  onChange: (text: string) => void;
  onWikilink: (target: string) => void;
  onModEnter: () => void;
  onReady: (view: EditorView | null) => void;
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
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          bidiKeys(),
          keymap.of([
            { key: "Mod-Enter", run: () => (cb.current.onModEnter(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          // GFM: task lists, strikethrough, bare-URL autolinks. Its keymap continues
          // lists/checklists on Enter and removes empty markers on Backspace.
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          livePreview({ onWikilink: (t) => cb.current.onWikilink(t) }),
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
              // CodeMirror scrolls its own scroller, which is not the sheet.
              // Keep the caret in the sheet's scroller, with room underneath.
              const view = u.view;
              requestAnimationFrame(() => requestAnimationFrame(() => scrollCaretIntoView(view)));
            }
            if (!u.docChanged || remote) return;
            // Edits pulled in from another device aren't the user's typing; don't save them back.
            cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    hideIosAccessory(view.contentDOM);
    onReady(view);
    return () => {
      onReady(null);
      view.destroy();
    };
    // The editor is created once per note; later text arrives through the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="note-body" dir="ltr" />;
}

/**
 * iOS draws a keyboard accessory (checkmark, up/down arrows) for text fields.
 * Swapping inputmode as focus lands is the web workaround that keeps the
 * keyboard and drops that bar.
 */
function hideIosAccessory(el: HTMLElement) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return;
  el.setAttribute("inputmode", "text");
  el.setAttribute("enterkeyhint", "enter");
  el.addEventListener("focus", () => {
    el.setAttribute("inputmode", "none");
    window.setTimeout(() => el.setAttribute("inputmode", "text"), 40);
  });
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
