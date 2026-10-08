"use client";

import { memo } from "react";
import type { Note } from "@/lib/types";
import { FolderIcon, MoreIcon } from "./icons";

interface Props {
  path: string;
  name: string;
  hue: number;
  total: number;
  subfolders: number;
  recent: Note[];
  index: number;
  animate: boolean;
  onOpen: (path: string) => void;
  onMenu: (path: string, anchor: HTMLElement) => void;
}

const plain = (s: string) =>
  s
    .slice(0, 420)
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]|\[([ xX])\]\s?/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

export const FolderCard = memo(function FolderCard({ path, name, hue, total, subfolders, recent, index, animate, onOpen, onMenu }: Props) {
  const shown = total > 4 ? recent.slice(0, 3) : recent.slice(0, 4);
  const more = total - shown.length;
  const tiles = total > 4 ? 3 : 4;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`fcard${animate ? " enter" : ""}`}
      style={{ "--h": hue, "--i": index } as React.CSSProperties}
      onClick={() => onOpen(path)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(path)}
      data-folder={path}
    >
      <div className="thumbs">
        {Array.from({ length: tiles }, (_, i) => {
          const n = shown[i];
          return n ? (
            <div className="thumb" key={n.id}>
              <div className="mini">
                {n.title && <b dir="auto">{n.title}</b>}
                {plain(n.body)}
              </div>
            </div>
          ) : (
            <div className="thumb blank" key={`b${i}`} />
          );
        })}
        {total > 4 && (
          <div className="thumb more">
            <strong>+{more}</strong>
            <span>more</span>
          </div>
        )}
      </div>
      <div className="fmeta">
        <div className="fname" dir="auto">{name}</div>
        <div className="fcount">
          <FolderIcon size={15} />
          {total} {total === 1 ? "note" : "notes"}
          {subfolders > 0 && ` · ${subfolders} ${subfolders === 1 ? "folder" : "folders"}`}
        </div>
      </div>
      <button
        className="icon-btn sm fmore"
        aria-label={`${name} options`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(path, e.currentTarget);
        }}
      >
        <MoreIcon size={20} />
      </button>
    </div>
  );
});
