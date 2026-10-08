"use client";

import { useMemo, useState } from "react";
import { baseName, parentOf } from "@/lib/derive";
import { createFolder } from "@/lib/store";
import { CheckIcon, FolderIcon, FolderPlusIcon, NotesIcon } from "./icons";
import { Sheet, prompt } from "./overlays";

interface Props {
  folders: string[];
  current: string;
  title?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ folders, current, title = "Move to folder", onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return t ? sorted.filter((p) => p.toLowerCase().includes(t)) : sorted;
  }, [folders, q]);

  const create = async () => {
    const name = await prompt({
      title: "New folder",
      message: current ? `Inside “${baseName(current)}”? Use “/” for nesting, or start with “/” for top level.` : "Use “/” to nest folders.",
      placeholder: "Folder name",
      initial: q.trim(),
      ok: "Create",
    });
    if (!name) return;
    const clean = name.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/:/g, "-");
    const path = clean.startsWith("/") || !current ? clean.replace(/^\/|\/$/g, "") : `${current}/${clean.replace(/\/$/, "")}`;
    if (!path) return;
    createFolder(path);
    onPick(path);
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <input
        className="sheet-search"
        placeholder="Search folders"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches}
      />
      <div className="sheet-list">
        <button className="sheet-item" onClick={create}>
          <FolderPlusIcon size={20} />
          <div className="path">
            <div>New folder{q.trim() ? ` “${q.trim()}”` : "…"}</div>
          </div>
        </button>
        {!q && (
          <button className={`sheet-item${current === "" ? " current" : ""}`} onClick={() => onPick("")}>
            <NotesIcon size={20} />
            <div className="path">
              <div>No folder</div>
            </div>
            {current === "" && <CheckIcon size={18} />}
          </button>
        )}
        {list.map((p) => (
          <button key={p} className={`sheet-item${p === current ? " current" : ""}`} onClick={() => onPick(p)}>
            <FolderIcon size={20} style={{ opacity: 0.7 }} />
            <div className="path">
              <div>{baseName(p)}</div>
              {parentOf(p) && <small>{parentOf(p)}</small>}
            </div>
            {p === current && <CheckIcon size={18} />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
