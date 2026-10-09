"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { baseName, shortDate } from "@/lib/derive";
import { freeze } from "@/lib/freeze";
import { previewSource, renderMarkdown, toggleTaskLine } from "@/lib/markdown";
import { updateNote } from "@/lib/store";
import type { Note, SortKey } from "@/lib/types";
import { CheckIcon, FolderIcon, PinFilledIcon, PinIcon } from "./icons";
import { useSelect } from "./select";

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
  const select = useSelect();
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
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

  const clearPress = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") holdOffNativeSelection();
    if (e.button !== 0 || select?.on) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input")) return;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        suppressClick.current = true;
        press.current = null;
        select?.arm(note.id);
      }, 420),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) clearPress();
  };

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (select?.on) {
      e.preventDefault();
      select.toggle(note.id);
      return;
    }
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
      className={`card${animate ? " enter" : ""}${select?.on ? " selecting" : ""}${select?.ids.has(note.id) ? " selected" : ""}`}
      style={animate ? ({ "--i": index } as React.CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.target !== ref.current) return;
        if (select?.on) select.toggle(note.id);
        else onOpen(note.id, ref.current!);
      }}
    >
      {select?.on && (
        <span className="card-check" aria-hidden="true">
          {select.ids.has(note.id) && <CheckIcon size={14} />}
        </span>
      )}
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
      {note.title && <h3 className="card-title" dir="auto">{termKey ? <Highlighted text={note.title} terms={terms!} /> : note.title}</h3>}
      <div
        ref={bodyRef}
        className={`card-body md${clipped ? " clipped" : ""}`}
        style={!note.title ? { fontSize: note.body.length < 90 ? 17 : undefined } : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <footer className="card-meta">
        {showFolder && note.folder && (
          <span className="chip" title={note.folder}>
            <FolderIcon size={12} />
            <span className="chip-text" ref={fadeWhenOverflowing}>
              {baseName(note.folder)}
            </span>
          </span>
        )}
        <time>{shortDate(note[dateKey])}</time>
      </footer>
    </article>
  );
});

// One shared observer for every card's folder name: fade it only when it doesn't fit.
let overflowObserver: ResizeObserver | null = null;
const checkOverflow = (el: Element) => el.classList.toggle("fade", el.scrollWidth > el.clientWidth + 1);

function fadeWhenOverflowing(el: HTMLSpanElement | null) {
  if (!el || typeof ResizeObserver === "undefined") return;
  overflowObserver ??= new ResizeObserver((entries) => entries.forEach((e) => checkOverflow(e.target)));
  overflowObserver.observe(el);
  checkOverflow(el);
  return () => overflowObserver?.unobserve(el);
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="hit">{part}</mark> : part))}
    </>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * iOS starts a native selection on long-press. That selection reaches the
 * Cancel label that mounts while the finger is still down, and the callout
 * steals the tap. Block selectstart for the gesture and keep collapsing any
 * range it manages to open.
 */
function holdOffNativeSelection() {
  const root = document.documentElement;
  root.classList.add("suppress-select");
  const stop = (ev: Event) => ev.preventDefault();
  const wipe = () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  };
  document.addEventListener("selectstart", stop, true);
  document.addEventListener("selectionchange", wipe);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    document.removeEventListener("selectstart", stop, true);
    wipe();
    window.setTimeout(() => {
      document.removeEventListener("selectionchange", wipe);
      root.classList.remove("suppress-select");
      wipe();
    }, 700);
  };
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}

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
