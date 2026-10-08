import { sortTime, type Frozen } from "./freeze";
import type { FolderDoc, FolderNode, Note, SortKey } from "./types";

export const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function buildFolderTree(notes: Iterable<Note>, folders: Iterable<FolderDoc>, sort: SortKey, frozen?: Frozen) {
  const nodes = new Map<string, FolderNode>();
  const ensure = (path: string): FolderNode => {
    let n = nodes.get(path);
    if (n) return n;
    n = { path, name: path ? baseName(path) : "Home", parent: parentOf(path), children: [], notes: [], total: 0 };
    nodes.set(path, n);
    if (path) {
      const parent = ensure(parentOf(path));
      parent.children.push(path);
    }
    return n;
  };
  ensure("");
  for (const f of folders) if (!f.deleted && f.path) ensure(f.path);
  for (const n of notes) {
    if (n.deleted) continue;
    const node = ensure(n.folder);
    if (n.archived) continue;
    node.notes.push(n);
    for (let p: string | null = n.folder; p !== null; p = p ? parentOf(p) : null) nodes.get(p)!.total++;
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    node.notes.sort(byDate(sort, frozen));
  }
  return nodes;
}

export const byDate = (key: SortKey, frozen?: Frozen) => (a: Note, b: Note) =>
  sortTime(b, key, frozen) - sortTime(a, key, frozen);

/** Most recent notes inside a folder, recursively — for folder card thumbnails. */
export function recentInFolder(tree: Map<string, FolderNode>, path: string, count: number): Note[] {
  const out: Note[] = [];
  const walk = (p: string) => {
    const node = tree.get(p);
    if (!node) return;
    out.push(...node.notes.slice(0, count));
    node.children.forEach(walk);
  };
  walk(path);
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, count);
}

export function countSubfolders(tree: Map<string, FolderNode>, path: string): number {
  const node = tree.get(path);
  if (!node) return 0;
  return node.children.reduce((s, c) => s + 1 + countSubfolders(tree, c), 0);
}

// --- search -----------------------------------------------------------------

const hayCache = new WeakMap<Note, { title: string; all: string }>();

function hay(n: Note) {
  let h = hayCache.get(n);
  if (!h) {
    const title = n.title.toLowerCase();
    h = { title, all: title + "\n" + n.body.toLowerCase() + "\n" + n.folder.toLowerCase() };
    hayCache.set(n, h);
  }
  return h;
}

export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Every term must appear somewhere; title hits rank first, then recency. */
export function searchNotes(notes: Iterable<Note>, q: string, sort: SortKey, frozen?: Frozen): Note[] {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const scored: { n: Note; s: number }[] = [];
  for (const n of notes) {
    if (n.deleted) continue;
    const h = hay(n);
    let ok = true;
    let s = 0;
    for (const t of terms) {
      if (!h.all.includes(t)) {
        ok = false;
        break;
      }
      if (h.title.includes(t)) s += h.title.startsWith(t) ? 3 : 2;
    }
    if (ok) scored.push({ n, s: s - (n.archived ? 1 : 0) });
  }
  scored.sort((a, b) => b.s - a.s || sortTime(b.n, sort, frozen) - sortTime(a.n, sort, frozen));
  return scored.map((x) => x.n);
}

export function searchFolders(tree: Map<string, FolderNode>, q: string): string[] {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const out: string[] = [];
  for (const p of tree.keys()) {
    if (!p) continue;
    const name = baseName(p).toLowerCase();
    if (terms.every((t) => name.includes(t))) out.push(p);
  }
  return out.sort((a, b) => a.length - b.length).slice(0, 12);
}

// --- dates ------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const yearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function shortDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : yearFmt.format(d);
}

export function longDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  return `${d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : yearFmt.format(d)}, ${timeFmt.format(d)}`;
}

// --- folder colors ------------------------------------------------------------

export const FOLDER_HUES = [268, 172, 42, 350, 212, 128, 22, 300, 190, 60];

/** Each top-level folder gets its own hue; subfolders inherit it. */
export function makeHue(tree: Map<string, FolderNode>) {
  const order = new Map((tree.get("")?.children ?? []).map((p, i) => [p, FOLDER_HUES[i % FOLDER_HUES.length]]));
  return (path: string) => order.get(path.split("/")[0]) ?? FOLDER_HUES[0];
}
