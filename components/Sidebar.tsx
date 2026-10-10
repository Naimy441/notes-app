"use client";

import type { User } from "firebase/auth";
import { useMemo, useRef, useState } from "react";
import { getAuthInstance } from "@/lib/firebase";
import { filingPayload, noteLabel, sanitizePlacements, type Placement } from "@/lib/filing";
import { applyTheme, setPref, usePrefs } from "@/lib/prefs";
import { navigate, type Route } from "@/lib/router";
import { getState, updateNote } from "@/lib/store";
import type { FolderNode, Note, ThemePref } from "@/lib/types";
import { themeTransition } from "@/lib/vt";
import { ArchiveIcon, FolderIcon, LogoutIcon, MoonIcon, NotesIcon, SparkIcon, SunIcon, SystemIcon, TrashIcon } from "./icons";
import { confirm, toast } from "./overlays";

interface Props {
  route: Route;
  tree: Map<string, FolderNode>;
  hue: (path: string) => number;
  counts: { notes: number; archive: number; trash: number };
  notes: Note[];
  user: User | null;
  onNavigate?: () => void;
  onSignOut: () => void;
}

export function Sidebar({ route, tree, hue, counts, notes, user, onNavigate, onSignOut }: Props) {
  const prefs = usePrefs();
  const go = (r: Partial<Route>) => {
    navigate({ note: null, q: null, ...r });
    onNavigate?.();
    window.scrollTo({ top: 0 });
  };
  const top = tree.get("")?.children ?? [];
  const activeTop = route.view === "folders" ? route.folder.split("/")[0] : null;

  const setTheme = (t: ThemePref, e: React.MouseEvent) => {
    themeTransition(
      () => {
        setPref("theme", t);
        applyTheme(t);
      },
      e.clientX,
      e.clientY,
    );
  };

  return (
    <nav className="nav">
      <button className={`nav-item${route.view === "notes" ? " active" : ""}`} onClick={() => go({ view: "notes" })}>
        <NotesIcon size={21} />
        <span>Notes</span>
        <small>{counts.notes}</small>
      </button>
      <button
        className={`nav-item${route.view === "folders" && !route.folder ? " active" : ""}`}
        onClick={() => go({ view: "folders", folder: "" })}
      >
        <FolderIcon size={21} />
        <span>Folders</span>
        <small>{top.length}</small>
      </button>
      {top.map((p) => (
        <button
          key={p}
          className={`nav-item sub${activeTop === p ? " active" : ""}`}
          onClick={() => go({ view: "folders", folder: p })}
        >
          <i className="dot" style={{ background: `hsl(${hue(p)} 60% 58%)` }} />
          <span>{tree.get(p)?.name}</span>
          <small>{tree.get(p)?.total}</small>
        </button>
      ))}
      <div className="nav-sep" />
      <button className={`nav-item${route.view === "archive" ? " active" : ""}`} onClick={() => go({ view: "archive" })}>
        <ArchiveIcon size={21} />
        <span>Archive</span>
        <small>{counts.archive || ""}</small>
      </button>
      <button className={`nav-item${route.view === "trash" ? " active" : ""}`} onClick={() => go({ view: "trash" })}>
        <TrashIcon size={21} />
        <span>Trash</span>
        <small>{counts.trash || ""}</small>
      </button>
      <div className="nav-sep" />
      <div className="nav-heading">Theme</div>
      <div className="seg" role="radiogroup" aria-label="Theme">
        {(
          [
            ["system", <SystemIcon key="s" size={16} />, "Auto"],
            ["light", <SunIcon key="l" size={16} />, "Light"],
            ["dark", <MoonIcon key="d" size={16} />, "Dark"],
          ] as const
        ).map(([t, icon, label]) => (
          <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? "on" : ""} onClick={(e) => setTheme(t, e)}>
            {icon}
            {label}
          </button>
        ))}
      </div>
      <div className="nav-heading">Sort by</div>
      <div className="seg" role="radiogroup" aria-label="Sort by">
        {(
          [
            ["updatedAt", "Modified"],
            ["createdAt", "Created"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={prefs.sort === k} className={prefs.sort === k ? "on" : ""} onClick={() => setPref("sort", k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="nav-sep" />
      <FileNotes tree={tree} hue={hue} notes={notes} />
      <div className="nav-sep" />
      {user && (
        <button
          className="nav-item"
          onClick={async () => {
            if (await confirm({ title: "Sign out?", message: "Notes cached on this device will be cleared.", ok: "Sign out" })) onSignOut();
          }}
        >
          <LogoutIcon size={21} />
          <span>
            Sign out
            <br />
            <small>{user.email}</small>
          </span>
        </button>
      )}
    </nav>
  );
}

function folderPaths(tree: Map<string, FolderNode>): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    const node = tree.get(path);
    if (!node) return;
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk("");
  return out;
}

function FileNotes({ tree, hue, notes }: { tree: Map<string, FolderNode>; hue: (path: string) => number; notes: Note[] }) {
  const paths = useMemo(() => folderPaths(tree), [tree]);
  const unfiled = useMemo(
    () =>
      notes
        .filter((n) => !n.deleted && n.folder === "")
        .sort((a, b) => noteLabel(a).localeCompare(noteLabel(b), undefined, { sensitivity: "base" }) || b.updatedAt - a.updatedAt),
    [notes],
  );
  const [plan, setPlan] = useState<Placement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const byId = useMemo(() => new Map(unfiled.map((n) => [n.id, n])), [unfiled]);
  const shown = useMemo(() => {
    if (!plan) return null;
    return plan
      .filter((p) => byId.has(p.id))
      .map((p) => ({ ...p, folder: p.folder && tree.has(p.folder) ? p.folder : null }));
  }, [plan, byId, tree]);
  const fileable = shown?.filter((p) => p.folder).length ?? 0;
  const staying = shown?.filter((p) => !p.folder).length ?? 0;

  const ask = async () => {
    if (busy || !paths.length || !unfiled.length) return;
    const tokenId = ++request.current;
    setBusy(true);
    setPlan(null);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const payload = filingPayload(paths, unfiled);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { placements?: unknown; error?: string };
      if (request.current !== tokenId) return;
      if (!res.ok) throw new Error(data.error || "AI filing failed");
      const sent = new Set(payload.notes.map((n) => n.id));
      const placements = sanitizePlacements(payload.folders, payload.notes.map((n) => n.id), data);
      const overflow = unfiled.filter((n) => !sent.has(n.id)).map((n) => ({ id: n.id, folder: null }));
      setPlan([...placements, ...overflow]);
    } catch (e) {
      if (request.current !== tokenId) return;
      toast(e instanceof Error ? e.message : "AI filing failed");
    } finally {
      if (request.current === tokenId) setBusy(false);
    }
  };

  const cancel = () => {
    request.current += 1;
    setBusy(false);
    setPlan(null);
  };

  const apply = () => {
    if (!shown) return;
    const latest = getState();
    let filed = 0;
    let stayed = 0;
    for (const item of shown) {
      const note = latest.notes.get(item.id);
      if (!note || note.deleted || note.folder) continue;
      if (!item.folder || !tree.has(item.folder)) {
        stayed++;
        continue;
      }
      updateNote(item.id, { folder: item.folder }, { touch: false });
      filed++;
    }
    setPlan(null);
    const moved = filed ? `Filed ${filed} ${filed === 1 ? "note" : "notes"}` : "";
    const left = stayed ? `${stayed} ${stayed === 1 ? "note stays" : "notes stay"} unfiled` : "";
    toast([moved, left].filter(Boolean).join(". ") || "Nothing to file");
  };

  return (
    <section className="filing" aria-label="File notes">
      <div className="nav-heading">File notes</div>
      <div className="filing-label">Folders</div>
      <div className="filing-scroll" role="list" aria-label="All folders">
        {paths.length === 0 && <p className="filing-empty">No folders yet</p>}
        {paths.map((p) => {
          const node = tree.get(p);
          if (!node) return null;
          const depth = p.split("/").length - 1;
          return (
            <div key={p} className="filing-row" role="listitem" style={{ paddingLeft: 8 + Math.min(depth, 6) * 12 }}>
              <i className="dot" style={{ background: `hsl(${hue(p)} 60% 58%)` }} />
              <span className="filing-name" dir="auto">
                {node.name}
              </span>
            </div>
          );
        })}
      </div>
      <div className="filing-label">
        {shown ? "Suggested" : "Unfiled"}
        {!shown && unfiled.length > 0 && <span className="filing-count">{unfiled.length}</span>}
      </div>
      {shown ? (
        <div className="filing-scroll" role="list" aria-label="Suggested filing">
          {shown.map((p) => {
            const note = byId.get(p.id);
            if (!note) return null;
            return (
              <div key={p.id} className={`filing-row plan${p.folder ? "" : " stay"}`} role="listitem">
                <span className="filing-name" dir="auto">
                  {noteLabel(note)}
                  {note.archived ? <small className="filing-tag">Archived</small> : null}
                </span>
                {p.folder ? (
                  <span className="filing-dest" dir="auto">
                    {p.folder}
                  </span>
                ) : (
                  <span className="filing-stay">Stays unfiled</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="filing-scroll" role="list" aria-label="Unfiled notes">
          {unfiled.length === 0 && <p className="filing-empty">No unfiled notes</p>}
          {unfiled.map((n) => (
            <div key={n.id} className="filing-row" role="listitem">
              <span className="filing-name" dir="auto">
                {noteLabel(n)}
                {n.archived ? <small className="filing-tag">Archived</small> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {shown ? (
        <>
          {staying > 0 && (
            <p className="filing-callout">
              {staying === 1 ? "1 note stays unfiled" : `${staying} notes stay unfiled`}
            </p>
          )}
          <div className="filing-actions">
            <button type="button" className="btn primary" disabled={fileable === 0} onClick={apply}>
              File notes
            </button>
            <button type="button" className="btn ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="nav-item filing-go"
            aria-label="File with AI"
            disabled={busy || paths.length === 0 || unfiled.length === 0}
            onClick={ask}
          >
            <SparkIcon size={18} />
            <span>{busy ? "Asking AI…" : "File with AI"}</span>
          </button>
          {!busy && paths.length === 0 && unfiled.length > 0 && <p className="filing-empty">Create a folder before filing.</p>}
          {!busy && paths.length > 0 && unfiled.length === 0 && <p className="filing-empty">Every note is already in a folder.</p>}
        </>
      )}
    </section>
  );
}
