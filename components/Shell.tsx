"use client";

import type { User } from "firebase/auth";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { baseName, buildFolderTree, byDate, countSubfolders, makeHue, parentOf, recentInFolder, searchFolders, searchNotes, searchTerms } from "@/lib/derive";
import { clearFrozen, freeze, holdContent, presentNote, releaseContent, useFrozen, useHeld } from "@/lib/freeze";
import { setPref, usePrefs } from "@/lib/prefs";
import { back, navigate, useRoute, type Route } from "@/lib/router";
import { createFolder, deleteFolder, getState, purgeNotes, renameFolder, updateNote, useStore, type StoreState } from "@/lib/store";
import type { FolderNode, Note } from "@/lib/types";
import { canMorphNote, quiet } from "@/lib/vt";
import { Editor } from "./Editor";
import { FolderCard } from "./FolderCard";
import { FolderPicker } from "./FolderPicker";
import {
  ArchiveIcon,
  BackIcon,
  BrandGlyph,
  ChevronRightIcon,
  CloseIcon,
  CloudDoneIcon,
  CloudOffIcon,
  CloudSyncIcon,
  FolderIcon,
  FolderPlusIcon,
  MenuIcon,
  MoreIcon,
  NotesIcon,
  PlusIcon,
  RenameIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";
import { GridSkeleton, NoteGrid } from "./NoteGrid";
import { OverlayHost, confirm, menu, prompt, toast } from "./overlays";
import { SelectProvider, type SelectApi } from "./select";
import { Sidebar } from "./Sidebar";

interface Props {
  user: User | null;
  onSignOut: () => void;
}

export function Shell({ user, onSignOut }: Props) {
  const store = useStore();
  const route = useRoute();
  const prefs = usePrefs();
  const sort = prefs.sort;
  const frozen = useFrozen();
  const held = useHeld();

  // Leaving a view re-sorts everything normally (edited notes move to their real place).
  const viewKey = `${route.view}|${route.folder}|${route.q !== null}`;
  useEffect(() => clearFrozen(), [viewKey]);

  const allNotes = useMemo(
    () => [...store.notes.values()].map((n) => presentNote(n, held)),
    [store, held],
  );
  const tree = useMemo(() => buildFolderTree(allNotes, store.folders.values(), sort, frozen), [allNotes, store.folders, sort, frozen]);
  const hue = useMemo(() => makeHue(tree), [tree]);
  const folderPaths = useMemo(() => [...tree.keys()].filter(Boolean), [tree]);
  const live = useMemo(() => allNotes.filter((n) => !n.deleted && !n.archived).sort(byDate(sort, frozen)), [allNotes, sort, frozen]);
  const counts = useMemo(
    () => ({
      notes: live.length,
      archive: allNotes.filter((n) => n.archived && !n.deleted).length,
      trash: allNotes.filter((n) => n.deleted).length,
    }),
    [allNotes, live],
  );

  // ── editor open/close with a card → sheet morph ───────────────────────────
  const [morph, setMorph] = useState(false);
  const [closing, setClosing] = useState(false);
  const openId = route.note;
  const realId = useRef<string | null>(null);
  useEffect(() => {
    if (openId && !openId.startsWith("new")) realId.current = openId;
  }, [openId]);

  useLayoutEffect(() => {
    if (!openId) {
      releaseContent();
      return;
    }
    const y = window.scrollY;
    document.body.classList.add("locked");
    document.body.style.top = `-${y}px`;
    return () => {
      document.body.classList.remove("locked");
      document.body.style.top = "";
      window.scrollTo(0, y);
    };
  }, [openId]);

  const openNote = useCallback((id: string, el?: HTMLElement) => {
    const note = getState().notes.get(id);
    freeze(note);
    holdContent(note);
    if (!el || !canMorphNote()) {
      navigate({ note: id });
      return;
    }
    el.style.viewTransitionName = "note-sheet";
    document.documentElement.classList.add("note-vt");
    const t = quiet(document.startViewTransition(() => {
      el.style.viewTransitionName = "";
      flushSync(() => {
        setMorph(true);
        navigate({ note: id });
      });
      document.querySelector<HTMLElement>(".editor")?.style.setProperty("view-transition-name", "note-sheet");
    }));
    t.finished.finally(() => {
      document.documentElement.classList.remove("note-vt");
      document.querySelector<HTMLElement>(".editor")?.style.removeProperty("view-transition-name");
    });
  }, []);

  const closeEditor = useCallback(() => {
    flushSync(() => releaseContent());
    const id = realId.current;
    const sheet = document.querySelector<HTMLElement>(".editor");
    const card = id ? document.querySelector<HTMLElement>(`.content [data-note-id="${CSS.escape(id)}"]`) : null;
    const r = card?.getBoundingClientRect();
    const onScreen = r && r.bottom > 0 && r.top < innerHeight && r.height > 0;
    if (canMorphNote() && sheet && card && onScreen) {
      sheet.style.viewTransitionName = "note-sheet";
      document.documentElement.classList.add("note-vt");
      const t = quiet(document.startViewTransition(async () => {
        sheet.style.viewTransitionName = "";
        await back({ note: null });
        flushSync(() => setMorph(false));
        document.querySelector<HTMLElement>(`.content [data-note-id="${CSS.escape(id!)}"]`)?.style.setProperty("view-transition-name", "note-sheet");
      }));
      t.finished.finally(() => {
        document.documentElement.classList.remove("note-vt");
        card.style.removeProperty("view-transition-name");
      });
      return;
    }
    setClosing(true);
    setTimeout(() => back({ note: null }), 190);
  }, []);

  // One editor instance per open: a draft turning into a real note ("new" → id) must not remount it.
  const [editorKey, setEditorKey] = useState(openId ?? "");
  const [prevOpen, setPrevOpen] = useState(openId);
  const [createdId, setCreatedId] = useState<string | null>(null);
  if (prevOpen !== openId) {
    setPrevOpen(openId);
    if (openId && openId !== createdId) setEditorKey(openId);
    if (!openId) {
      setClosing(false);
      setMorph(false);
    }
  }

  const onCreated = useCallback((id: string) => {
    holdContent(getState().notes.get(id));
    realId.current = id;
    setCreatedId(id);
    navigate({ note: id }, { replace: true });
  }, []);

  const openWikilink = useCallback(
    (target: string) => {
      const t = target.trim().toLowerCase();
      const name = t.split("/").pop()!.replace(/\.md$/, "");
      const hit =
        allNotes.find((n) => !n.deleted && n.path?.toLowerCase().replace(/\.md$/, "").endsWith(t)) ??
        allNotes.find((n) => !n.deleted && n.title.toLowerCase() === name);
      if (hit) navigate({ note: hit.id });
      else toast(`No note named “${target}”`);
    },
    [allNotes],
  );

  // ── search ────────────────────────────────────────────────────────────────
  const searching = route.q !== null;
  const q = useDeferredValue(route.q ?? "");
  const queryActive = q.trim().length > 0;
  const results = useMemo(() => (queryActive ? searchNotes(allNotes, q, sort, frozen) : []), [allNotes, q, queryActive, sort, frozen]);
  const folderHits = useMemo(() => (q.trim() ? searchFolders(tree, q) : []), [tree, q]);
  const terms = useMemo(() => searchTerms(q), [q]);
  const searchInput = useRef<HTMLInputElement>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setMoving(false);
  }, [route.view, route.folder, searching]);
  const selectApi = useMemo<SelectApi>(
    () => ({
      on: selecting,
      ids: selected,
      toggle: (id: string) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      arm: (id: string) => {
        setSelecting(true);
        setSelected((cur) => new Set(cur).add(id));
      },
    }),
    [selecting, selected],
  );
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
    setMoving(false);
  };
  const deleteSelected = () => {
    const ids = [...selected];
    if (!ids.length) return;
    const chosen = ids.map((id) => getState().notes.get(id)).filter((n): n is Note => !!n);
    if (chosen.length && chosen.every((n) => n.deleted)) {
      purgeNotes(ids);
      toast(`Deleted ${ids.length} ${ids.length === 1 ? "note" : "notes"}`);
    } else {
      ids.forEach((id) => updateNote(id, { deleted: true }));
      toast(`Moved ${ids.length} ${ids.length === 1 ? "note" : "notes"} to trash`, {
        label: "Undo",
        run: () => ids.forEach((id) => updateNote(id, { deleted: false }, { touch: false })),
      });
    }
    exitSelect();
  };

  useEffect(() => {
    if (openId && !openId.startsWith("new")) holdContent(getState().notes.get(openId));
  }, [openId]);

  // ── chrome ────────────────────────────────────────────────────────────────
  const [drawer, setDrawer] = useState<"open" | "closing" | null>(null);
  const closeDrawer = () => {
    setDrawer("closing");
    setTimeout(() => setDrawer(null), 210);
  };
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 4));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const defaultFolder = route.view === "folders" ? route.folder : "";
  const newNote = useCallback(() => navigate({ note: "new" }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (route.note || t.matches("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (e.key === "c" || e.key === "n") {
        e.preventDefault();
        newNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route.note, newNote]);

  // ── folder actions ────────────────────────────────────────────────────────
  const folderMenu = useCallback(
    (path: string, anchor: HTMLElement) => {
      const node = tree.get(path);
      menu(anchor, [
        {
          label: "Rename",
          icon: <RenameIcon size={20} />,
          run: async () => {
            const name = await prompt({ title: "Rename folder", initial: baseName(path), ok: "Rename" });
            if (!name || name === baseName(path)) return;
            const parent = parentOf(path);
            const to = (parent ? `${parent}/` : "") + name.replace(/[/\\:]/g, "-");
            if (tree.has(to)) return toast("A folder with that name already exists");
            renameFolder(path, to);
            if (route.view === "folders" && (route.folder === path || route.folder.startsWith(path + "/")))
              navigate({ folder: to + route.folder.slice(path.length) }, { replace: true });
          },
        },
        {
          label: "New subfolder",
          icon: <FolderPlusIcon size={20} />,
          run: async () => {
            const name = await prompt({ title: "New folder", message: `Inside “${baseName(path)}”`, placeholder: "Folder name", ok: "Create" });
            if (name) createFolder(`${path}/${name.replace(/[/\\:]/g, "-")}`);
          },
        },
        {
          label: "Delete",
          icon: <TrashIcon size={20} />,
          danger: true,
          run: async () => {
            const total = node?.total ?? 0;
            const ok = await confirm({
              title: `Delete “${baseName(path)}”?`,
              message: total ? `Its ${total} ${total === 1 ? "note moves" : "notes move"} to the trash.` : "This folder is empty.",
              ok: "Delete",
              danger: true,
            });
            if (!ok) return;
            const ids = allNotes.filter((n) => !n.deleted && (n.folder === path || n.folder.startsWith(path + "/"))).map((n) => n.id);
            deleteFolder(path);
            if (route.view === "folders" && route.folder.startsWith(path)) navigate({ folder: parentOf(path) }, { replace: true });
            toast("Folder deleted", {
              label: "Undo",
              run: () => {
                createFolder(path);
                ids.forEach((id) => updateNote(id, { deleted: false }, { touch: false }));
              },
            });
          },
        },
      ]);
    },
    [tree, allNotes, route.view, route.folder],
  );

  const newFolder = async (parent: string) => {
    const name = await prompt({
      title: "New folder",
      message: parent ? `Inside “${baseName(parent)}”` : undefined,
      placeholder: "Folder name",
      ok: "Create",
    });
    if (!name) return;
    const path = (parent ? `${parent}/` : "") + name.replace(/[\\:]/g, "-").replace(/^\/+|\/+$/g, "");
    createFolder(path);
    toast(`Created “${baseName(path)}”`);
  };

  // ── content ───────────────────────────────────────────────────────────────
  const gridProps = { dateKey: sort, onOpen: openNote, onWikilink: openWikilink };
  const loading = !store.cacheLoaded || (store.notes.size === 0 && !store.serverSynced && !store.error);

  let content: React.ReactNode;
  if (loading) {
    content = <GridSkeleton />;
  } else if (searching && queryActive) {
    content = (
      <SearchResults
        q={q}
        results={results}
        folderHits={folderHits}
        tree={tree}
        hue={hue}
        terms={terms}
        gridProps={gridProps}
      />
    );
  } else if (route.view === "notes") {
    content = (
      <>
        {live.length > 0 && !selecting && (
          <div className="home-select-row">
            <button className="text-btn" onClick={() => setSelecting(true)}>
              Select
            </button>
          </div>
        )}
        <PinnedAndOthers notes={live} resetKey="notes" showFolder gridProps={gridProps} empty="Notes you add appear here" />
      </>
    );
  } else if (route.view === "folders") {
    content = (
      <FolderView
        path={route.folder}
        tree={tree}
        hue={hue}
        gridProps={gridProps}
        onFolderMenu={folderMenu}
        onNewFolder={newFolder}
      />
    );
  } else if (route.view === "archive") {
    const archived = allNotes.filter((n) => n.archived && !n.deleted).sort(byDate(sort, frozen));
    content = (
      <>
        <h1 className="page-title">Archive</h1>
        {archived.length ? (
          <NoteGrid notes={archived} resetKey="archive" showFolder {...gridProps} />
        ) : (
          <Empty icon={<ArchiveIcon size={72} />} text="Archived notes appear here" />
        )}
      </>
    );
  } else {
    const trashed = allNotes.filter((n) => n.deleted).sort(byDate("updatedAt", frozen));
    content = (
      <>
        <div className="folder-head">
          <h1 className="title">Trash</h1>
          {trashed.length > 0 && (
            <button
              className="btn ghost"
              onClick={async () => {
                if (await confirm({ title: "Empty trash?", message: `${trashed.length} notes will be deleted forever.`, ok: "Empty trash", danger: true }))
                  purgeNotes(trashed.map((n) => n.id));
              }}
            >
              Empty trash
            </button>
          )}
        </div>
        {trashed.length ? (
          <NoteGrid notes={trashed} resetKey="trash" showFolder {...gridProps} />
        ) : (
          <Empty icon={<TrashIcon size={72} />} text="No notes in trash" />
        )}
      </>
    );
  }

  const sidebarProps = { route, tree, hue, counts, user, onSignOut };

  return (
    <SelectProvider value={selectApi}>
    <div className="shell">
      <header className={`topbar${scrolled ? " scrolled" : ""}`} inert={openId ? true : undefined}>
        <div className="topbar-row">
          <div className="brand desk-only topbar-brand">
            <div className="brand-mark">
              <BrandGlyph size={19} />
            </div>
            Notes
          </div>
          <div className="searchbar">
            {searching ? (
              <button className="icon-btn" aria-label="Close search" onClick={() => back({ q: null })}>
                <BackIcon />
              </button>
            ) : (
              <>
                <button className="icon-btn mobile-only" aria-label="Menu" onClick={() => setDrawer("open")}>
                  <MenuIcon />
                </button>
                <span className="icon-btn desk-only" aria-hidden="true">
                  <SearchIcon />
                </span>
              </>
            )}
            <input
              ref={searchInput}
              type="search"
              dir="auto"
              placeholder="Search your notes"
              value={route.q ?? ""}
              onFocus={() => route.q === null && navigate({ q: "" })}
              onChange={(e) => navigate({ q: e.target.value }, { replace: true })}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.currentTarget.blur();
                  back({ q: null });
                }
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {route.q ? (
              <button className="icon-btn" aria-label="Clear search" onClick={() => navigate({ q: "" }, { replace: true })}>
                <CloseIcon size={20} />
              </button>
            ) : (
              <SyncBadge store={store} />
            )}
          </div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar-desktop">
          <Sidebar {...sidebarProps} />
        </aside>
        <main className="content" inert={openId ? true : undefined}>
          {store.error && !store.serverSynced && (
            <div className="chip" style={{ margin: "8px 0", whiteSpace: "normal", color: "var(--danger)" }}>
              Sync error: {store.error}
            </div>
          )}
          {content}
        </main>
      </div>

      {!openId && !selecting && (
        <button className="fab" aria-label="New note" onClick={newNote}>
          <PlusIcon size={28} strokeWidth={2.2} />
        </button>
      )}

      {selecting && !openId && (
        <div className="select-bar" role="toolbar" aria-label="Selected notes">
          <button className="text-btn" onClick={exitSelect}>
            Cancel
          </button>
          <span>
            {selected.size} selected
          </span>
          <button className="btn ghost" disabled={selected.size === 0} onClick={() => setMoving(true)}>
            Move
          </button>
          <button className="btn danger" disabled={selected.size === 0} onClick={deleteSelected}>
            Delete
          </button>
        </div>
      )}

      {drawer && (
        <>
          <div className={`drawer-backdrop${drawer === "closing" ? " closing" : ""}`} onClick={closeDrawer} />
          <aside className={`drawer${drawer === "closing" ? " closing" : ""}`}>
            <div className="brand">
              <div className="brand-mark">
                <BrandGlyph size={19} />
              </div>
              Notes
            </div>
            <Sidebar {...sidebarProps} onNavigate={closeDrawer} />
          </aside>
        </>
      )}

      {openId && (
        <Editor
          key={editorKey}
          noteId={openId}
          defaultFolder={defaultFolder}
          folders={folderPaths}
          vtName={morph}
          closing={closing}
          onClose={closeEditor}
          onCreated={onCreated}
          onWikilink={openWikilink}
        />
      )}

      {moving && (
        <FolderPicker
          folders={folderPaths}
          current=""
          onClose={() => setMoving(false)}
          onPick={(p) => {
            const ids = [...selected];
            ids.forEach((id) => updateNote(id, { folder: p }, { touch: false }));
            toast(
              ids.length
                ? p
                  ? `Moved ${ids.length} ${ids.length === 1 ? "note" : "notes"} to ${baseName(p)}`
                  : `Moved ${ids.length} ${ids.length === 1 ? "note" : "notes"} out of folders`
                : "Nothing selected",
            );
            exitSelect();
          }}
        />
      )}

      <OverlayHost />
    </div>
    </SelectProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type GridProps = {
  dateKey: "updatedAt" | "createdAt";
  onOpen: (id: string, el: HTMLElement) => void;
  onWikilink: (t: string) => void;
};

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="empty">
      {icon}
      <div>{text}</div>
    </div>
  );
}

function PinnedAndOthers({
  notes,
  resetKey,
  showFolder,
  gridProps,
  empty,
}: {
  notes: Note[];
  resetKey: string;
  showFolder?: boolean;
  gridProps: GridProps;
  empty?: string;
}) {
  const pinned = useMemo(() => notes.filter((n) => n.pinned), [notes]);
  const others = useMemo(() => notes.filter((n) => !n.pinned), [notes]);
  const { pinnedCollapsed } = usePrefs();
  if (!notes.length) return empty ? <Empty icon={<NotesIcon size={72} />} text={empty} /> : null;
  // Folding is only offered when there are other notes to jump to.
  const folded = pinnedCollapsed && others.length > 0;
  const toggle = () => {
    setPref("pinnedCollapsed", !folded);
    window.scrollTo({ top: 0 });
  };
  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className="section-row">
            <button
              className="section-label section-toggle"
              onClick={others.length ? toggle : undefined}
              aria-expanded={!folded}
              title={others.length ? (folded ? "Show pinned notes" : "Fold pinned notes") : undefined}
            >
              {others.length > 0 && <ChevronRightIcon size={14} className={folded ? "" : "open"} />}
              Pinned
              <span className="section-count">{pinned.length}</span>
            </button>
          </div>
          {!folded && <NoteGrid notes={pinned} resetKey={resetKey + ":p"} showFolder={showFolder} {...gridProps} />}
        </>
      )}
      {others.length > 0 && (
        <>
          {pinned.length > 0 && (
            <div className="section-label">
              Others<span className="section-count">{others.length}</span>
            </div>
          )}
          <NoteGrid notes={others} resetKey={resetKey + ":o"} showFolder={showFolder} {...gridProps} />
        </>
      )}
    </>
  );
}

function FolderGrid({
  paths,
  tree,
  hue,
  animateKey,
  onMenu,
}: {
  paths: string[];
  tree: Map<string, FolderNode>;
  hue: (p: string) => number;
  animateKey: string;
  onMenu: (path: string, anchor: HTMLElement) => void;
}) {
  const [animKey, setAnimKey] = useState(animateKey);
  useEffect(() => {
    const t = setTimeout(() => setAnimKey(""), 900);
    return () => clearTimeout(t);
  }, [animateKey]);
  const open = useCallback((p: string) => {
    navigate({ view: "folders", folder: p, q: null });
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <div className="fgrid">
      {paths.map((p, i) => {
        const node = tree.get(p)!;
        return (
          <FolderCard
            key={p}
            path={p}
            name={node.name}
            hue={hue(p)}
            total={node.total}
            subfolders={countSubfolders(tree, p)}
            recent={recentInFolder(tree, p, 4)}
            index={i}
            animate={animKey === animateKey}
            onOpen={open}
            onMenu={onMenu}
          />
        );
      })}
    </div>
  );
}

function FolderView({
  path,
  tree,
  hue,
  gridProps,
  onFolderMenu,
  onNewFolder,
}: {
  path: string;
  tree: Map<string, FolderNode>;
  hue: (p: string) => number;
  gridProps: GridProps;
  onFolderMenu: (path: string, anchor: HTMLElement) => void;
  onNewFolder: (parent: string) => void;
}) {
  const node = tree.get(path);
  if (!node) {
    return <Empty icon={<FolderIcon size={72} />} text="This folder doesn't exist anymore" />;
  }
  const parts = path ? path.split("/") : [];
  return (
    <>
      {path ? (
        <>
          <div className="crumbs">
            <button onClick={() => navigate({ folder: "" })}>Folders</button>
            {parts.slice(0, -1).map((p, i) => (
              <span key={i} style={{ display: "contents" }}>
                <ChevronRightIcon size={14} />
                <button onClick={() => navigate({ folder: parts.slice(0, i + 1).join("/") })}>{p}</button>
              </span>
            ))}
          </div>
          <div className="folder-head">
            <button className="icon-btn" aria-label="Up" onClick={() => back({ folder: parentOf(path) })}>
              <BackIcon />
            </button>
            <h1 className="title">
              <i
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 4,
                  marginRight: 10,
                  verticalAlign: "middle",
                  background: `hsl(${hue(path)} 60% 58%)`,
                }}
              />
              {node.name}
            </h1>
            <button className="icon-btn" aria-label="New subfolder" onClick={() => onNewFolder(path)}>
              <FolderPlusIcon />
            </button>
            <button className="icon-btn" aria-label="Folder options" onClick={(e) => onFolderMenu(path, e.currentTarget)}>
              <MoreIcon />
            </button>
          </div>
        </>
      ) : (
        <div className="folder-head">
          <h1 className="title">Folders</h1>
          <button className="icon-btn" aria-label="New folder" onClick={() => onNewFolder("")}>
            <FolderPlusIcon />
          </button>
        </div>
      )}
      {node.children.length > 0 && (
        <>
          {path && <div className="section-label">Folders</div>}
          <div style={{ marginTop: path ? 0 : 12 }}>
            <FolderGrid paths={node.children} tree={tree} hue={hue} animateKey={`f:${path}`} onMenu={onFolderMenu} />
          </div>
        </>
      )}
      {node.notes.length > 0 && (
        <>
          {(node.children.length > 0 || !path) && !node.notes.some((n) => n.pinned) && (
            <div className="section-label">{path ? "Notes" : "Unfiled notes"}</div>
          )}
          <PinnedAndOthers notes={node.notes} resetKey={`f:${path}`} gridProps={gridProps} />
        </>
      )}
      {!node.children.length && !node.notes.length && <Empty icon={<FolderIcon size={72} />} text="This folder is empty" />}
    </>
  );
}

function SearchResults({
  q,
  results,
  folderHits,
  tree,
  hue,
  terms,
  gridProps,
}: {
  q: string;
  results: Note[];
  folderHits: string[];
  tree: Map<string, FolderNode>;
  hue: (p: string) => number;
  terms: string[];
  gridProps: GridProps;
}) {
  if (!q.trim()) return <Empty icon={<SearchIcon size={72} />} text="Search titles, text and folders" />;
  return (
    <>
      {folderHits.length > 0 && (
        <>
          <div className="section-label">Folders</div>
          <FolderGrid paths={folderHits} tree={tree} hue={hue} animateKey={`s:${q}`} onMenu={() => {}} />
        </>
      )}
      <div className="section-label">
        {results.length} {results.length === 1 ? "note" : "notes"}
      </div>
      {results.length ? (
        <NoteGrid notes={results} resetKey={`s:${q}`} showFolder terms={terms} {...gridProps} />
      ) : (
        <Empty icon={<SearchIcon size={72} />} text="No matching notes" />
      )}
    </>
  );
}

function SyncBadge({ store }: { store: StoreState }) {
  const state = !store.online ? "offline" : store.pending > 0 || !store.serverSynced ? "syncing" : "synced";
  const label =
    state === "offline"
      ? "Offline — edits are saved on this device and will sync later"
      : state === "syncing"
        ? "Syncing…"
        : "All changes synced";
  return (
    <button className={`icon-btn sync${state === "syncing" ? " busy" : ""}`} aria-label={label} title={label} onClick={() => toast(label)}>
      {state === "offline" ? <CloudOffIcon size={22} /> : state === "syncing" ? <CloudSyncIcon size={22} /> : <CloudDoneIcon size={22} />}
    </button>
  );
}

export type { Route };
