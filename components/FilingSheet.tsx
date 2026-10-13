"use client";

import { useMemo, useRef, useState } from "react";
import { baseName } from "@/lib/derive";
import { getAuthInstance } from "@/lib/firebase";
import { filingPayload, noteLabel, sanitizePlacements } from "@/lib/filing";
import { getState, updateNote } from "@/lib/store";
import type { FolderNode, Note } from "@/lib/types";
import { SparkIcon } from "./icons";
import { Sheet, toast } from "./overlays";

interface Props {
  tree: Map<string, FolderNode>;
  hue: (path: string) => number;
  notes: Note[];
  onClose: () => void;
}

/** Every folder path, parents before their children. */
function allFolders(tree: Map<string, FolderNode>): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const child of tree.get(path)?.children ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk("");
  return out;
}

type Row = { id: string; folder: string | null; include: boolean };

/**
 * Lists every folder and every note that isn't in one, asks the AI where each
 * note belongs, and lets you adjust the suggestions before anything moves.
 */
export function FilingSheet({ tree, hue, notes, onClose }: Props) {
  const folders = useMemo(() => allFolders(tree), [tree]);
  const unfiled = useMemo(
    () => notes.filter((n) => !n.deleted && n.folder === "").sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );
  const byId = useMemo(() => new Map(unfiled.map((n) => [n.id, n])), [unfiled]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const suggest = async () => {
    if (busy || !folders.length || !unfiled.length) return;
    if (!navigator.onLine) return toast("AI needs a connection");
    const ticket = ++request.current;
    setBusy(true);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const payload = filingPayload(folders, unfiled);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { placements?: unknown; error?: string };
      if (request.current !== ticket) return;
      if (!res.ok) throw new Error(data.error || "AI filing failed");
      const placed = new Map(sanitizePlacements(payload.folders, payload.notes.map((n) => n.id), data).map((p) => [p.id, p.folder]));
      setRows(unfiled.map((n) => ({ id: n.id, folder: placed.get(n.id) ?? null, include: !!placed.get(n.id) })));
    } catch (e) {
      if (request.current === ticket) toast(e instanceof Error ? e.message : "AI filing failed");
    } finally {
      if (request.current === ticket) setBusy(false);
    }
  };

  const update = (id: string, patch: Partial<Row>) =>
    setRows((cur) => cur?.map((r) => (r.id === id ? { ...r, ...patch, include: patch.folder !== undefined ? !!patch.folder : (patch.include ?? r.include) } : r)) ?? null);

  const chosen = rows?.filter((r) => r.include && r.folder && tree.has(r.folder)) ?? [];

  const apply = () => {
    const live = getState().notes;
    const moved: string[] = [];
    for (const r of chosen) {
      const n = live.get(r.id);
      if (!n || n.deleted || n.folder) continue; // filed or deleted elsewhere meanwhile
      updateNote(r.id, { folder: r.folder! }, { touch: false });
      moved.push(r.id);
    }
    onClose();
    if (!moved.length) return toast("Nothing was filed");
    toast(`Filed ${moved.length} ${moved.length === 1 ? "note" : "notes"}`, {
      label: "Undo",
      run: () => moved.forEach((id) => updateNote(id, { folder: "" }, { touch: false })),
    });
  };

  const close = () => {
    request.current++;
    onClose();
  };

  const folderOptions = folders.map((p) => (
    <option key={p} value={p}>
      {p.split("/").join(" › ")}
    </option>
  ));

  return (
    <Sheet title="File notes with AI" onClose={close} wide>
      <p className="filing-intro">
        {unfiled.length
          ? `${unfiled.length} ${unfiled.length === 1 ? "note isn't" : "notes aren't"} in a folder. The AI suggests one of your ${folders.length} folders for each; nothing moves until you confirm.`
          : "Every note is already in a folder."}
      </p>
      <div className={`sheet-list filing-list${busy ? " busy" : ""}`}>
        {rows ? (
          rows.map((r) => {
            const n = byId.get(r.id);
            if (!n) return null;
            return (
              <label key={r.id} className={`filing-row${r.include ? "" : " off"}`}>
                <input type="checkbox" checked={r.include} disabled={!r.folder} onChange={(e) => update(r.id, { include: e.target.checked })} />
                <span className="filing-note" dir="auto">
                  {noteLabel(n)}
                  {n.archived && <small className="filing-tag">Archived</small>}
                </span>
                <select
                  className="filing-select"
                  value={r.folder ?? ""}
                  onChange={(e) => update(r.id, { folder: e.target.value || null })}
                  aria-label={`Folder for ${noteLabel(n)}`}
                >
                  <option value="">Leave unfiled</option>
                  {folderOptions}
                </select>
              </label>
            );
          })
        ) : (
          <>
            {unfiled.length > 0 && <div className="filing-heading">Unfiled notes</div>}
            {unfiled.map((n) => (
              <div key={n.id} className="filing-row static">
                <span className="filing-note" dir="auto">
                  {noteLabel(n)}
                  {n.archived && <small className="filing-tag">Archived</small>}
                </span>
              </div>
            ))}
            <div className="filing-heading">Your folders</div>
            {folders.length === 0 && <p className="filing-empty">No folders yet — create one first.</p>}
            {folders.map((p) => (
              <div key={p} className="filing-row static folder" style={{ paddingInlineStart: 12 + Math.min(p.split("/").length - 1, 6) * 16 }}>
                <i className="dot" style={{ background: `hsl(${hue(p)} 60% 58%)` }} />
                <span className="filing-note" dir="auto">
                  {baseName(p)}
                </span>
                <small className="filing-count">{tree.get(p)?.total ?? 0}</small>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="filing-actions">
        {rows ? (
          <>
            <button type="button" className="btn ghost" onClick={() => setRows(null)}>
              Back
            </button>
            <button type="button" className="btn primary" disabled={!chosen.length} onClick={apply}>
              {chosen.length ? `File ${chosen.length} ${chosen.length === 1 ? "note" : "notes"}` : "Nothing to file"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={close}>
              Close
            </button>
            <button type="button" className="btn primary" disabled={busy || !folders.length || !unfiled.length} onClick={suggest}>
              <SparkIcon size={18} />
              {busy ? "Asking AI…" : "Suggest folders"}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
