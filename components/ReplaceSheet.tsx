"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { baseName } from "@/lib/derive";
import { DEFAULT_FIND, compileFind, excerpt, findAll, matchAt, replaceAllIn, replacementFor, type FindOptions, type Match } from "@/lib/find";
import { noteLabel } from "@/lib/filing";
import { getState, updateNote } from "@/lib/store";
import type { Note } from "@/lib/types";
import { ReplaceIcon, SearchIcon } from "./icons";
import { Sheet, toast } from "./overlays";

interface Props {
  notes: Note[];
  initialQuery: string;
  onClose: () => void;
}

/** Rows shown at once; the rest are still included (and counted) unless unticked. */
const SHOWN = 200;

interface Hit {
  note: Note;
  title: Match[];
  body: Match[];
}

/** Titles are one line: a replacement can't break one. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

/**
 * Find & replace across every note (not the trash). Lists each note with a
 * match and a preview of the change; untick notes to leave them alone.
 * Nothing changes until you confirm, and Undo puts every note back.
 */
export function ReplaceSheet({ notes, initialQuery, onClose }: Props) {
  const [opts, setOpts] = useState<FindOptions>({ ...DEFAULT_FIND, query: initialQuery });
  const [replacement, setReplacement] = useState("");
  const [titles, setTitles] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());

  const deferred = useDeferredValue(opts);
  const { re, error } = useMemo(() => compileFind(deferred), [deferred]);
  const hits = useMemo<Hit[]>(() => {
    if (!re) return [];
    const out: Hit[] = [];
    for (const note of notes) {
      if (note.deleted) continue;
      const title = titles ? findAll(note.title, re, 100) : [];
      const body = findAll(note.body, re, 1000);
      if (title.length || body.length) out.push({ note, title, body });
    }
    return out.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  }, [notes, re, titles]);

  const chosen = hits.filter((h) => !skipped.has(h.note.id));
  const matchCount = chosen.reduce((n, h) => n + h.title.length + h.body.length, 0);
  const allOn = hits.length > 0 && chosen.length === hits.length;

  const toggle = (id: string) =>
    setSkipped((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () => {
    const { re: live } = compileFind(opts);
    if (!live) return;
    const changed: { id: string; before: { title: string; body: string }; after: { title: string; body: string } }[] = [];
    let count = 0;
    for (const h of chosen) {
      // Work from the note as it is now, in case it changed while the sheet was open.
      const n = getState().notes.get(h.note.id);
      if (!n || n.deleted) continue;
      const t = titles ? replaceAllIn(n.title, live, replacement, opts) : { text: n.title, count: 0 };
      const b = replaceAllIn(n.body, live, replacement, opts);
      if (!t.count && !b.count) continue;
      const after = { title: oneLine(t.text), body: b.text };
      changed.push({ id: n.id, before: { title: n.title, body: n.body }, after });
      updateNote(n.id, after);
      count += t.count + b.count;
    }
    onClose();
    if (!changed.length) return toast("Nothing was replaced");
    toast(`Replaced ${count} in ${changed.length} ${changed.length === 1 ? "note" : "notes"}`, {
      label: "Undo",
      run: () => {
        let kept = 0;
        for (const c of changed) {
          const n = getState().notes.get(c.id);
          // A note edited again since is left as it is now.
          if (!n || n.title !== c.after.title || n.body !== c.after.body) {
            kept++;
            continue;
          }
          updateNote(c.id, c.before);
        }
        toast(kept ? `Undone, except ${kept} ${kept === 1 ? "note" : "notes"} edited since` : "Replace undone");
      },
    });
  };

  const set = (patch: Partial<FindOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const status = !opts.query
    ? "Type what to find."
    : error
      ? error
      : hits.length
        ? `${matchCount} ${matchCount === 1 ? "match" : "matches"} in ${chosen.length} of ${hits.length} ${hits.length === 1 ? "note" : "notes"}`
        : "No matches.";

  return (
    <Sheet title="Replace in notes" onClose={onClose} wide>
      <div className="replace-fields">
        <label className={`find-field${error ? " invalid" : ""}`}>
          <SearchIcon size={17} />
          <input
            type="text"
            value={opts.query}
            placeholder="Find"
            aria-label="Find"
            dir="auto"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label className="find-field">
          <ReplaceIcon size={17} />
          <input
            type="text"
            value={replacement}
            placeholder="Replace with (empty deletes)"
            aria-label="Replace with"
            dir="auto"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
          />
        </label>
        <div className="find-opts">
          <button type="button" className={`find-opt${opts.caseSensitive ? " on" : ""}`} aria-pressed={opts.caseSensitive} onClick={() => set({ caseSensitive: !opts.caseSensitive })}>
            Match case
          </button>
          <button type="button" className={`find-opt${opts.wholeWord ? " on" : ""}`} aria-pressed={opts.wholeWord} onClick={() => set({ wholeWord: !opts.wholeWord })}>
            Whole word
          </button>
          <button type="button" className={`find-opt${opts.regex ? " on" : ""}`} aria-pressed={opts.regex} onClick={() => set({ regex: !opts.regex })}>
            Regex
          </button>
          <button type="button" className={`find-opt${opts.keepCase ? " on" : ""}`} aria-pressed={!!opts.keepCase} onClick={() => set({ keepCase: !opts.keepCase })}>
            Keep case
          </button>
          <button type="button" className={`find-opt${titles ? " on" : ""}`} aria-pressed={titles} onClick={() => setTitles(!titles)}>
            Titles too
          </button>
        </div>
      </div>
      <div className="replace-status">
        <span className={error ? "err" : undefined}>{status}</span>
        {hits.length > 1 && (
          <button type="button" className="text-btn" onClick={() => setSkipped(allOn ? new Set(hits.map((h) => h.note.id)) : new Set())}>
            {allOn ? "Select none" : "Select all"}
          </button>
        )}
      </div>
      <div className={`sheet-list replace-list${deferred !== opts ? " busy" : ""}`}>
        {hits.slice(0, SHOWN).map((h) => {
          const on = !skipped.has(h.note.id);
          const n = h.title.length + h.body.length;
          const [text, m] = h.body.length ? [h.note.body, h.body[0]] : [h.note.title, h.title[0]];
          const ex = excerpt(text, m);
          return (
            <label key={h.note.id} className={`replace-row${on ? "" : " off"}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(h.note.id)} />
              <span className="replace-main">
                <span className="replace-title" dir="auto">
                  {noteLabel(h.note)}
                  {h.note.folder && <small className="filing-tag">{baseName(h.note.folder)}</small>}
                  {h.note.archived && <small className="filing-tag">Archived</small>}
                </span>
                <span className="replace-excerpt" dir="auto">
                  {ex.before}
                  <del>{ex.hit}</del>
                  {(replacement || opts.regex) && <ins>{previewReplacement(text, m, opts, replacement)}</ins>}
                  {ex.after}
                </span>
              </span>
              <small className="replace-count">{n}</small>
            </label>
          );
        })}
        {hits.length > SHOWN && <p className="filing-empty">…and {hits.length - SHOWN} more notes</p>}
      </div>
      <div className="filing-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!matchCount || !!error} onClick={apply}>
          {matchCount ? `Replace ${matchCount} in ${chosen.length} ${chosen.length === 1 ? "note" : "notes"}` : "Replace"}
        </button>
      </div>
    </Sheet>
  );
}

/** What the first match in a row turns into (regex groups expanded). */
function previewReplacement(text: string, m: Match, opts: FindOptions, replacement: string) {
  const { re } = compileFind(opts);
  const found = re && matchAt(text, re, m.from);
  return found ? replacementFor(replacement, found, opts) : replacement;
}
