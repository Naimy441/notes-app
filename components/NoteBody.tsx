"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";
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

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
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
          EditorView.lineWrapping,
          // Each line picks its own direction, so Arabic lines read right-to-left.
          EditorView.perLineTextDirection.of(true),
          EditorView.contentAttributes.of({ autocapitalize: "sentences", autocorrect: "on", spellcheck: "true", "aria-label": "Note" }),
          placeholder("Note"),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            // Edits pulled in from another device aren't the user's typing; don't save them back.
            if (u.transactions.every((tr) => tr.annotation(Transaction.remote))) return;
            cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    onReady(view);
    return () => {
      onReady(null);
      view.destroy();
    };
    // The editor is created once per note; later text arrives through the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="note-body" dir="auto" />;
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
