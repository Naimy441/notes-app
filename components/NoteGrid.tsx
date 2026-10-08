"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note, SortKey } from "@/lib/types";
import { NoteCard, PREVIEW_CHARS } from "./NoteCard";

const MIN_CARD = 210;
const PAGE = 48;

function useColumns(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ cols: 2, colPx: 170, gap: 10 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 10;
      const cols = Math.min(6, Math.max(2, Math.floor((w + gap) / (MIN_CARD + gap))));
      const colPx = (w - (cols - 1) * gap) / cols;
      setSize((s) => (s.cols === cols && Math.abs(s.colPx - colPx) < 8 ? s : { cols, colPx, gap }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Cheap height guess so cards can be packed into the shortest column, left-to-right like Keep. */
function estimate(n: Note, colPx: number) {
  const cpl = Math.max(14, colPx / 7.4); // chars per line at 14px
  let h = 46; // padding + footer
  if (n.title) h += Math.ceil(n.title.length / (cpl * 0.85)) * 20 + 6;
  const body = n.body.length > PREVIEW_CHARS ? n.body.slice(0, PREVIEW_CHARS) : n.body;
  let lines = 0;
  for (const l of body.split("\n", 40)) {
    lines += Math.max(1, Math.ceil(l.length / cpl));
    if (lines >= 14) break;
  }
  if (body) h += Math.min(14, lines) * 20.7;
  return h;
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * Keep every already-placed card in its column; pack only cards seen for the first
 * time into the shortest column. Returns the same map when nothing new was placed.
 */
function pack(notes: Note[], placed: ReadonlyMap<string, number>, cols: number, colPx: number, gap: number) {
  const columns: { note: Note; i: number }[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  const fresh: { note: Note; i: number }[] = [];
  notes.forEach((note, i) => {
    const c = placed.get(note.id);
    if (c === undefined || c >= cols) return fresh.push({ note, i });
    columns[c].push({ note, i });
    heights[c] += estimate(note, colPx) + gap;
  });
  if (!fresh.length) return { columns, col: placed };
  const col = new Map(placed);
  for (const item of fresh) {
    let c = 0;
    for (let k = 1; k < cols; k++) if (heights[k] < heights[c] - 24) c = k;
    col.set(item.note.id, c);
    columns[c].push(item);
    heights[c] += estimate(item.note, colPx) + gap;
  }
  for (const list of columns) list.sort((a, b) => a.i - b.i);
  return { columns, col };
}

interface Props {
  notes: Note[];
  /** Changing this resets paging and replays the entrance animation. */
  resetKey: string;
  showFolder?: boolean;
  dateKey: SortKey;
  terms?: string[];
  onOpen: (id: string, el: HTMLElement) => void;
  onWikilink: (target: string) => void;
}

export function NoteGrid({ notes, resetKey, showFolder = false, dateKey, terms, onOpen, onWikilink }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { cols, colPx, gap } = useColumns(ref);
  const [limit, setLimit] = useState(PAGE);
  const [animKey, setAnimKey] = useState(resetKey);
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setLimit(PAGE);
    setAnimKey(resetKey);
  }
  // Only the first screenful animates in; later pages appear instantly.
  const animating = animKey === resetKey;
  useEffect(() => {
    const t = setTimeout(() => setAnimKey(""), 900);
    return () => clearTimeout(t);
  }, [resetKey]);

  const visible = notes.length > limit ? notes.slice(0, limit) : notes;

  // Sticky columns: once a card is placed in a column it stays there for as long as
  // this view is open, so edits, reorders and new pages never reshuffle the grid.
  const layoutKey = `${resetKey}|${cols}`;
  const [layout, setLayout] = useState({ key: layoutKey, col: EMPTY });
  const placed = layout.key === layoutKey ? layout.col : EMPTY;
  const { columns, col } = useMemo(() => pack(visible, placed, cols, colPx, gap), [visible, placed, cols, colPx, gap]);
  if (col !== placed) setLayout({ key: layoutKey, col });

  const hasMore = notes.length > limit;
  useEffect(() => {
    if (!hasMore || !sentinel.current) return;
    const io = new IntersectionObserver(
      (es) => es[0].isIntersecting && setLimit((l) => l + PAGE),
      { rootMargin: "1600px 0px" },
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [hasMore, limit]);

  return (
    <>
      <div ref={ref} className="masonry">
        {columns.map((col, c) => (
          <div className="col" key={c}>
            {col.map(({ note, i }) => (
              <NoteCard
                key={note.id}
                note={note}
                index={i}
                animate={animating && i < 24}
                showFolder={showFolder}
                dateKey={dateKey}
                terms={terms}
                onOpen={onOpen}
                onWikilink={onWikilink}
              />
            ))}
          </div>
        ))}
      </div>
      {hasMore && <div ref={sentinel} className="sentinel" />}
    </>
  );
}

// Fixed, natural-looking card shapes (lines of body text per card) so the
// placeholder resembles a real notes grid rather than random blocks.
const SKELETON_CARDS = [5, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4, 2, 6, 3, 5, 4];

/**
 * Placeholder grid shown only when notes take a while to arrive (first load on a
 * new device). Waits `delay` ms before appearing so fast loads never flash it.
 */
export function GridSkeleton({ delay = 450 }: { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cols } = useColumns(ref);
  const [visible, setVisible] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div ref={ref} className="masonry skel-grid" aria-hidden="true" style={{ opacity: visible ? 1 : 0 }}>
      {Array.from({ length: cols }, (_, c) => (
        <div className="col" key={c}>
          {SKELETON_CARDS.filter((_, i) => i % cols === c).map((lines, i) => (
            <div key={i} className="skel">
              <div className="skel-line title" />
              {Array.from({ length: lines }, (_, j) => (
                <div key={j} className="skel-line" style={{ width: j === lines - 1 ? "55%" : `${88 - ((i + j) % 3) * 9}%` }} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
