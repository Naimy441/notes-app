"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { baseName, shortDate } from "@/lib/derive";
import { freeze } from "@/lib/freeze";
import { previewSource, renderMarkdown, toggleTaskLine } from "@/lib/markdown";
import { updateNote } from "@/lib/store";
import type { Note, SortKey } from "@/lib/types";
import { FolderIcon, PinFilledIcon, PinIcon } from "./icons";

export const PREVIEW_CHARS = 1200;

interface Props {
  note: Note;
  index: number;
  animate: boolean;
  showFolder: boolean;
  dateKey: SortKey;
  terms?: string[];
  onOpen: (id: string, el: HTMLElement) => void;
  onWikilink: (target: string) => void;
}

export const NoteCard = memo(function NoteCard({ note, index, animate, showFolder, dateKey, terms, onOpen, onWikilink }: Props) {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const src = useMemo(() => previewSource(note.body, PREVIEW_CHARS), [note.body]);
  const html = useMemo(() => renderMarkdown(src, `${note.id}:${note.updatedAt}`), [src, note.id, note.updatedAt]);
  const clipped = note.body.length > 520 || note.body.split("\n", 16).length > 14;
  const termKey = terms?.join("\u0000") ?? "";

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.querySelector("mark.hit")) el.innerHTML = html; // drop marks from a previous query
    if (termKey) highlight(el, termKey.split("\u0000"));
  }, [html, termKey]);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.dataset.taskLine) {
      e.stopPropagation();
      freeze(note); // don't let the card jump away from under your finger
      updateNote(note.id, { body: toggleTaskLine(note.body, Number(t.dataset.taskLine)) });
      return;
    }
    const wl = t.closest<HTMLElement>("a.wikilink");
    if (wl) {
      e.preventDefault();
      e.stopPropagation();
      onWikilink(wl.dataset.wikilink ?? "");
      return;
    }
    if (t.closest("a[href]")) {
      e.stopPropagation();
      return;
    }
    onOpen(note.id, ref.current!);
  };

  return (
    <article
      ref={ref}
      data-note-id={note.id}
      className={`card${animate ? " enter" : ""}`}
      style={animate ? ({ "--i": index } as React.CSSProperties) : undefined}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && e.target === ref.current && onOpen(note.id, ref.current!)}
    >
      <button
        className={`icon-btn sm card-pin${note.pinned ? " on" : ""}`}
        aria-label={note.pinned ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          updateNote(note.id, { pinned: !note.pinned }, { touch: false });
        }}
      >
        {note.pinned ? <PinFilledIcon size={18} /> : <PinIcon size={18} />}
      </button>
      {note.title && <h3 className="card-title">{termKey ? <Highlighted text={note.title} terms={terms!} /> : note.title}</h3>}
      <div
        ref={bodyRef}
        className={`card-body md${clipped ? " clipped" : ""}`}
        style={!note.title ? { fontSize: note.body.length < 90 ? 17 : undefined } : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <footer className="card-meta">
        {showFolder && note.folder && (
          <span className="chip">
            <FolderIcon size={12} />
            {baseName(note.folder)}
          </span>
        )}
        <time>{shortDate(note[dateKey])}</time>
      </footer>
    </article>
  );
});

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="hit">{part}</mark> : part))}
    </>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap search hits in <mark> inside already-rendered HTML, text nodes only. */
export function highlight(root: HTMLElement, terms: string[]) {
  const ts = terms.filter(Boolean);
  if (!ts.length) return;
  const re = new RegExp(ts.map(escapeRe).join("|"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index));
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index! + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
