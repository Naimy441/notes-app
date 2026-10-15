"use client";

import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_FIND, MATCH_LIMIT, compileFind, findAll, replaceAllIn, type FindOptions } from "@/lib/find";
import { findState, onFindChange, replaceAll, replaceCurrent, selectNearest, setFindQuery, stepMatch } from "@/lib/findEditor";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, ReplaceIcon, SearchIcon } from "./icons";
import { toast } from "./overlays";

/** What opened (or re-focused) the bar. `seq` changes on every request. */
export interface FindRequest {
  query?: string;
  replace?: boolean;
  /** Put the cursor in the find field (not when opened from list search on a phone: no keyboard). */
  focus: boolean;
  seq: number;
}

interface Props {
  view: React.RefObject<EditorView | null>;
  request: FindRequest;
  /** The note is locked (the AI is editing it): finding works, replacing doesn't. */
  readOnly: boolean;
  /** The note's title and its element: title matches are highlighted and included in "All". */
  title: string;
  titleEl: React.RefObject<HTMLElement | null>;
  onReplaceTitle: (title: string) => void;
  onClose: () => void;
}

// Match case / whole word / regex stay as you left them for the rest of the visit.
let lastOptions: Omit<FindOptions, "query"> = { caseSensitive: false, wholeWord: false, regex: false, keepCase: false };
let lastReplacement = "";

/** The find & replace bar under the note's top bar. Matching lives in lib/findEditor.ts. */
export function FindBar({ view, request, readOnly, title, titleEl, onReplaceTitle, onClose }: Props) {
  const [opts, setOpts] = useState<FindOptions>(() => ({ ...DEFAULT_FIND, ...lastOptions, query: request.query ?? "" }));
  const [replacement, setReplacement] = useState(lastReplacement);
  const [expanded, setExpanded] = useState(!!request.replace);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  // Where the caret was when the search started: typing more of the query keeps
  // the current match near it instead of walking forward on every keystroke.
  // A new request (e.g. ⌘F on another selection) starts from the caret again.
  const origin = useRef<number | null>(null);
  const originSeq = useRef(request.seq);

  const { re, error } = useMemo(() => compileFind(opts), [opts]);

  // Subscribed before the search below runs, so its first results re-render the count.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    return onFindChange(v, rerender);
  }, [view]);

  // Run the search whenever the query or an option changes.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    if (originSeq.current !== request.seq) {
      originSeq.current = request.seq;
      origin.current = null;
    }
    origin.current ??= v.state.selection.main.from;
    v.dispatch({ effects: setFindQuery.of({ re, regex: opts.regex, keepCase: !!opts.keepCase }) });
    selectNearest(v, origin.current);
    // A request alone doesn't re-run the search; only a changed query does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, re, opts.regex, opts.keepCase]);

  // Closing the bar clears the highlights.
  useEffect(() => {
    const v = view.current;
    return () => v?.dispatch({ effects: setFindQuery.of({ re: null, regex: false, keepCase: false }) });
  }, [view]);

  useEffect(() => {
    lastOptions = { caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord, regex: opts.regex, keepCase: opts.keepCase };
  }, [opts.caseSensitive, opts.wholeWord, opts.regex, opts.keepCase]);
  useEffect(() => {
    lastReplacement = replacement;
  }, [replacement]);

  // A new request (⌘F again, ⌘⇧H, a selection to search for) updates the open bar.
  const [seenSeq, setSeenSeq] = useState(request.seq);
  if (seenSeq !== request.seq) {
    setSeenSeq(request.seq);
    if (request.query !== undefined && request.query !== opts.query) setOpts((o) => ({ ...o, query: request.query! }));
    if (request.replace) setExpanded(true);
  }
  useEffect(() => {
    if (!request.focus) return;
    // Straight to "Replace with" only when there's already something to find.
    const el = request.replace && findInput.current?.value ? replaceInput.current : findInput.current;
    el?.focus();
    el?.select();
  }, [request]);

  // Title matches: highlighted with the CSS Highlight API (no markup in the title), counted apart.
  const titleMatches = useMemo(() => (re && title ? findAll(title, re, 100) : []), [re, title]);
  useEffect(() => {
    const node = titleEl.current?.firstChild;
    if (!titleMatches.length || !(node instanceof Text) || typeof Highlight === "undefined" || !CSS.highlights) return;
    const ranges = titleMatches.flatMap((m) => {
      if (m.to > node.length) return [];
      const r = new Range();
      r.setStart(node, m.from);
      r.setEnd(node, m.to);
      return [r];
    });
    CSS.highlights.set("find-title", new Highlight(...ranges));
    return () => {
      CSS.highlights.delete("find-title");
    };
  }, [titleMatches, titleEl]);
  const latestTitle = useRef(title);
  useEffect(() => {
    latestTitle.current = title;
  }, [title]);

  const v = view.current;
  const s = v ? findState(v) : null;
  const total = s?.matches.length ?? 0;
  const current = s?.current ?? -1;
  const inTitle = titleMatches.length ? ` +${titleMatches.length} title` : "";
  const count = !opts.query
    ? ""
    : error
      ? error
      : total === 0
        ? titleMatches.length
          ? `In title only (${titleMatches.length})`
          : "No results"
        : `${current >= 0 ? `${current + 1} of ` : ""}${total}${total >= MATCH_LIMIT ? "+" : ""}${inTitle}`;

  const step = (dir: 1 | -1) => {
    if (v) stepMatch(v, dir);
  };
  const toggle = (key: "caseSensitive" | "wholeWord" | "regex" | "keepCase") => {
    origin.current = v?.state.selection.main.from ?? null;
    setOpts((o) => ({ ...o, [key]: !o[key] }));
  };
  const replaceOne = () => {
    if (!v || readOnly || !total) return;
    replaceCurrent(v, replacement);
  };
  const replaceEvery = () => {
    if (!v || readOnly || !re || (!total && !titleMatches.length)) return;
    const done = replaceAll(v, replacement);
    const doc = v.state.doc;
    const oldTitle = title;
    const t = titleMatches.length ? replaceAllIn(title, re, replacement, opts) : null;
    const newTitle = t ? t.text.replace(/\s*\n\s*/g, " ") : title;
    if (t?.count) onReplaceTitle(newTitle);
    const n = done + (t?.count ?? 0);
    if (!n) return;
    toast(`Replaced ${n} ${n === 1 ? "match" : "matches"}`, {
      label: "Undo",
      run: () => {
        // Only while nothing else has been typed since; ⌘Z still works after that.
        let changed = false;
        if (done) {
          if (v.state.doc === doc) undo(v);
          else changed = true;
        }
        if (t?.count) {
          if (latestTitle.current === newTitle) onReplaceTitle(oldTitle);
          else changed = true;
        }
        if (changed) toast("The note changed since — use ⌘Z to undo the text");
      },
    });
  };

  const optionKeys = (e: React.KeyboardEvent) => {
    // Alt+C / Alt+W / Alt+R / Alt+P, as in most editors.
    if (!e.altKey || e.metaKey || e.ctrlKey) return false;
    const key = { KeyC: "caseSensitive", KeyW: "wholeWord", KeyR: "regex", KeyP: "keepCase" }[e.code] as
      | "caseSensitive"
      | "wholeWord"
      | "regex"
      | "keepCase"
      | undefined;
    if (!key) return false;
    e.preventDefault();
    toggle(key);
    return true;
  };

  return (
    <div className="find-bar" role="search" aria-label="Find and replace">
      <div className="find-row">
        <button
          type="button"
          className={`icon-btn sm find-expand${expanded ? " open" : ""}`}
          aria-label={expanded ? "Hide replace" : "Replace and options"}
          aria-expanded={expanded}
          title={expanded ? "Hide replace" : "Replace and options"}
          onClick={() => setExpanded((x) => !x)}
        >
          <ChevronRightIcon size={18} />
        </button>
        <label className={`find-field${error ? " invalid" : ""}`}>
          <SearchIcon size={17} />
          <input
            ref={findInput}
            type="text"
            value={opts.query}
            placeholder="Find in note"
            aria-label="Find in note"
            dir="auto"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(e) => setOpts((o) => ({ ...o, query: e.target.value }))}
            onKeyDown={(e) => {
              if (optionKeys(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          <span className={`find-count${opts.query && !total && !titleMatches.length ? " none" : ""}`} aria-live="polite">
            {count}
          </span>
        </label>
        <button type="button" className="icon-btn sm" aria-label="Previous match" title="Previous (⇧↵)" disabled={!total} onClick={() => step(-1)}>
          <ChevronUpIcon size={20} />
        </button>
        <button type="button" className="icon-btn sm" aria-label="Next match" title="Next (↵)" disabled={!total} onClick={() => step(1)}>
          <ChevronDownIcon size={20} />
        </button>
        <button type="button" className="icon-btn sm" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={19} />
        </button>
      </div>
      {expanded && (
        <>
          <div className="find-row">
            <label className="find-field">
              <ReplaceIcon size={17} />
              <input
                ref={replaceInput}
                type="text"
                value={replacement}
                placeholder="Replace with"
                aria-label="Replace with"
                dir="auto"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (optionKeys(e)) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.metaKey || e.ctrlKey) replaceEvery();
                    else replaceOne();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                  }
                }}
              />
            </label>
            <button type="button" className="find-btn" disabled={readOnly || !total} onClick={replaceOne} title="Replace this match (↵)">
              Replace
            </button>
            <button
              type="button"
              className="find-btn"
              disabled={readOnly || (!total && !titleMatches.length)}
              onClick={replaceEvery}
              title="Replace every match, title included (⌘↵)"
            >
              All
            </button>
          </div>
          <div className="find-opts" role="group" aria-label="Find options">
            <OptionChip on={opts.caseSensitive} label="Match case" hint="Alt+C" onClick={() => toggle("caseSensitive")} />
            <OptionChip on={opts.wholeWord} label="Whole word" hint="Alt+W" onClick={() => toggle("wholeWord")} />
            <OptionChip on={opts.regex} label="Regex" hint="Alt+R" onClick={() => toggle("regex")} />
            <OptionChip on={!!opts.keepCase} label="Keep case" hint="Alt+P" onClick={() => toggle("keepCase")} />
            {opts.regex && <span className="find-hint">$1, $&amp; in the replacement</span>}
          </div>
        </>
      )}
    </div>
  );
}

function OptionChip({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" className={`find-opt${on ? " on" : ""}`} aria-pressed={on} title={`${label} (${hint})`} onClick={onClick}>
      {label}
    </button>
  );
}

