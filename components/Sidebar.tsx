"use client";

import type { User } from "firebase/auth";
import { applyTheme, setPref, usePrefs } from "@/lib/prefs";
import { navigate, type Route } from "@/lib/router";
import type { FolderNode, ThemePref } from "@/lib/types";
import { themeTransition } from "@/lib/vt";
import { ArchiveIcon, FolderIcon, LogoutIcon, MoonIcon, NotesIcon, SunIcon, SystemIcon, TrashIcon } from "./icons";
import { confirm } from "./overlays";

interface Props {
  route: Route;
  tree: Map<string, FolderNode>;
  hue: (path: string) => number;
  counts: { notes: number; archive: number; trash: number };
  user: User | null;
  onNavigate?: () => void;
  onSignOut: () => void;
}

export function Sidebar({ route, tree, hue, counts, user, onNavigate, onSignOut }: Props) {
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
