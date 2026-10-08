"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { baseName, longDate } from "@/lib/derive";
import { renderMarkdown, toggleTaskLine } from "@/lib/markdown";
import { createNote, discardNote, flushPending, newNoteId, purgeNotes, updateNote, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import { FolderPicker } from "./FolderPicker";
import {
  ArchiveIcon,
  BackIcon,
  CheckboxIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  FolderIcon,
  LinkIcon,
  MoreIcon,
  PinFilledIcon,
  PinIcon,
  RestoreIcon,
  TrashIcon,
  UnarchiveIcon,
} from "./icons";
import { confirm, linkPrompt, menu, toast } from "./overlays";

interface Props {
  /** Existing note id, or "new" / "new:list" for a fresh draft. */
  noteId: string;
  defaultFolder: string;
  folders: string[];
  /** Set while a view transition is morphing the card into this sheet. */
  vtName: boolean;
  closing: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  onWikilink: (target: string) => void;
}

/** Build a Markdown link, normalizing bare domains and escaping characters that would break it. */
function markdownLink(text: string, rawUrl: string) {
  let url = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
  url = url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  if (!text) return `<${url}>`;
  return `[${text.replace(/([[\]\\])/g, "\\$1")}](${url})`;
}

const LIST_RE = /^(\s*)([-*+]|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Keep the sheet above the iOS keyboard, which doesn't resize fixed elements. */
function useVisualViewport(ref: React.RefObject<HTMLElement | null>) {
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const mobile = window.innerWidth < 700;
      if (mobile) {
        el.style.setProperty("--vvh", `${vv.height}px`);
        el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
      }
      setKb(vv.height < window.innerHeight - 120);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [ref]);
  return kb;
}

export function Editor({ noteId, defaultFolder, folders, vtName, closing, onClose, onCreated, onWikilink }: Props) {
  const { notes } = useStore();
  const isNew = noteId.startsWith("new");
  const [id] = useState(() => (isNew ? newNoteId() : noteId));
  const note: Note | undefined = notes.get(id);
  const created = !!note;

  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [mode, setMode] = useState<"edit" | "preview">(isNew || !note?.body ? "edit" : "preview");
  const [showCreated, setShowCreated] = useState(false);
  const [picking, setPicking] = useState(false);

  const sheet = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const kb = useVisualViewport(sheet);

  // Pull in edits from other devices unless the user is typing in that field.
  const remoteBody = note?.body;
  const remoteTitle = note?.title;
  useEffect(() => {
    if (remoteBody !== undefined && document.activeElement !== bodyRef.current) setBody(remoteBody);
  }, [remoteBody]);
  useEffect(() => {
    if (remoteTitle !== undefined && document.activeElement !== titleRef.current) setTitle(remoteTitle);
  }, [remoteTitle]);

  useLayoutEffect(() => autosize(titleRef.current), [title]);
  useLayoutEffect(() => {
    autosize(bodyRef.current);
    if (mode === "edit" && pendingCaret.current !== null && bodyRef.current) {
      const el = bodyRef.current;
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      el.focus({ preventScroll: true });
      el.setSelectionRange(pos, pos);
      // Scroll the caret's line into view.
      const lineH = 25.6;
      const line = body.slice(0, pos).split("\n").length - 1;
      const scroller = el.closest(".editor-scroll");
      if (scroller) scroller.scrollTop = Math.max(0, el.offsetTop + line * lineH - scroller.clientHeight / 3);
    }
  }, [body, mode]);

  useEffect(() => {
    if (!isNew) return;
    // Focus after the open animation so iOS raises the keyboard reliably.
    titleRef.current?.focus({ preventScroll: true });
  }, [isNew]);

  const save = useCallback(
    (patch: { title?: string; body?: string }) => {
      if (!created) {
        const t = patch.title ?? title;
        const b = patch.body ?? body;
        if (!t.trim() && !b.trim()) return;
        createNote(id, { title: t, body: b, folder: defaultFolder });
        onCreated(id);
        return;
      }
      updateNote(id, patch, { debounce: true });
    },
    [created, id, title, body, defaultFolder, onCreated],
  );

  const close = useCallback(() => {
    flushPending(id);
    const n = notes.get(id);
    if (n && !n.title.trim() && !n.body.trim() && !n.deleted) {
      discardNote(id);
      toast("Empty note discarded");
    }
    onClose();
  }, [id, notes, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !picking && !document.querySelector(".menu-layer, .dialog")) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, picking]);

  const html = useMemo(() => (mode === "preview" ? renderMarkdown(body) : ""), [mode, body]);

  const enterEdit = (caret: number | null) => {
    const pos = caret ?? body.length;
    if (mode === "edit" && bodyRef.current) {
      bodyRef.current.focus();
      bodyRef.current.setSelectionRange(pos, pos);
      return;
    }
    pendingCaret.current = pos;
    setMode("edit");
  };

  const onPreviewClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.dataset.taskLine) {
      const next = toggleTaskLine(body, Number(t.dataset.taskLine));
      setBody(next);
      save({ body: next });
      return;
    }
    const wl = t.closest<HTMLElement>("a.wikilink");
    if (wl) {
      e.preventDefault();
      onWikilink(wl.dataset.wikilink ?? "");
      return;
    }
    if (t.closest("a[href]")) return;
    if (window.getSelection()?.toString()) return; // let people select text to copy
    const block = t.closest<HTMLElement>("[data-line]");
    if (!block) return enterEdit(null);
    // Put the caret at the end of the tapped block (paragraph, list item, heading…).
    let line = Number(block.dataset.lineEnd ?? block.dataset.line);
    const lines = body.split("\n");
    while (line > Number(block.dataset.line) && !lines[line]?.trim()) line--;
    let pos = 0;
    for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
    enterEdit(pos + (lines[line]?.length ?? 0));
  };

  const insert = (text: string, replaceFrom?: number) => {
    const el = bodyRef.current!;
    if (replaceFrom !== undefined) el.setSelectionRange(replaceFrom, el.selectionEnd);
    // execCommand keeps the native undo stack; fall back if it's unavailable.
    if (!document.execCommand("insertText", false, text)) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const pos = el.selectionStart;
    const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1;
    const line = el.value.slice(lineStart, pos);
    const m = LIST_RE.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.length === m[0].length) {
      insert("", lineStart); // empty item: end the list
      return;
    }
    const [, indent, bullet, num, delim, task] = m;
    const marker = num ? `${Number(num) + 1}${delim}` : bullet;
    insert(`\n${indent}${marker} ${task ? "[ ] " : ""}`);
  };

  const addLink = async () => {
    const el = mode === "edit" ? bodyRef.current : null;
    const start = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const selected = el ? el.value.slice(start, end) : "";
    const selIsUrl = /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(selected);
    const res = await linkPrompt({ text: selIsUrl ? "" : selected.trim(), url: selIsUrl ? selected.trim() : "" });
    if (!res) {
      el?.focus();
      return;
    }
    const md = markdownLink(res.text, res.url);
    if (el) {
      el.focus();
      el.setSelectionRange(start, end);
      insert(md);
    } else {
      const next = body.replace(/\s*$/, "") + (body.trim() ? "\n" : "") + md;
      setBody(next);
      save({ body: next });
    }
  };
  const addLinkRef = useRef(addLink);
  useLayoutEffect(() => {
    addLinkRef.current = addLink;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (picking || document.querySelector(".dialog, .menu-layer")) return;
        if (e.target === titleRef.current) return;
        e.preventDefault();
        addLinkRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const toggleChecklist = () => {
    if (mode === "preview") {
      const next = body.replace(/\s*$/, "") + (body.trim() ? "\n" : "") + "- [ ] ";
      setBody(next);
      save({ body: next });
      enterEdit(next.length);
      return;
    }
    const el = bodyRef.current!;
    const pos = el.selectionStart;
    const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1;
    let lineEnd = el.value.indexOf("\n", pos);
    if (lineEnd < 0) lineEnd = el.value.length;
    const line = el.value.slice(lineStart, lineEnd);
    const m = /^(\s*)[-*+]\s+\[[ xX]\]\s+/.exec(line) ?? /^(\s*)[-*+]\s+\[[ xX]\]$/.exec(line);
    el.focus();
    el.setSelectionRange(lineStart, lineEnd);
    const plainLine = line.replace(/^(\s*)[-*+]\s+/, "$1");
    insert(m ? line.slice(m[0].length) : `${line.match(/^\s*/)![0]}- [ ] ${plainLine.trimStart()}`);
  };

  const n = note;
  const act = (patch: Partial<Note>, msg: string, undo: Partial<Note>) => {
    if (!n) return;
    updateNote(id, patch, { touch: false });
    toast(msg, { label: "Undo", run: () => updateNote(id, undo, { touch: false }) });
  };

  const more = (anchor: HTMLElement) => {
    const items = [
      {
        label: "Copy text",
        icon: <CopyIcon size={20} />,
        run: () => {
          navigator.clipboard.writeText([title, body].filter(Boolean).join("\n\n")).then(() => toast("Copied"));
        },
      },
      { label: "Move to folder", icon: <FolderIcon size={20} />, run: () => setPicking(true) },
    ];
    if (n?.deleted) {
      items.push(
        {
          label: "Restore",
          icon: <RestoreIcon size={20} />,
          run: () => act({ deleted: false }, "Note restored", { deleted: true }),
        },
        {
          label: "Delete forever",
          icon: <TrashIcon size={20} />,
          run: async () => {
            if (await confirm({ title: "Delete forever?", message: "This can't be undone.", ok: "Delete", danger: true })) {
              purgeNotes([id]);
              onClose();
            }
          },
        } as (typeof items)[number],
      );
    } else if (n) {
      items.push({
        label: "Delete",
        icon: <TrashIcon size={20} />,
        run: () => {
          act({ deleted: true }, "Note moved to trash", { deleted: false });
          onClose();
        },
      });
    }
    menu(anchor, items.map((it) => ({ ...it, danger: it.label.startsWith("Delete") })));
  };

  return (
    <>
      <div className={`editor-backdrop${vtName ? " vt" : ""}${closing ? " closing" : ""}`} onClick={close} />
      <div
        ref={sheet}
        className={`editor${vtName ? " vt" : ""}${closing ? " closing" : ""}${kb ? " kb" : ""}`}
        style={vtName ? { viewTransitionName: "note-sheet" } : undefined}
        role="dialog"
        aria-label={title || "Note"}
      >
        <div className="editor-top">
          <button className="icon-btn" aria-label="Back" onClick={close}>
            <BackIcon />
          </button>
          <div className="spacer" />
          {n && (
            <>
              <button
                className={`icon-btn${n.pinned ? " on" : ""}`}
                aria-label={n.pinned ? "Unpin" : "Pin"}
                onClick={() => updateNote(id, { pinned: !n.pinned }, { touch: false })}
              >
                {n.pinned ? <PinFilledIcon /> : <PinIcon />}
              </button>
              {!n.deleted && (
                <button
                  className="icon-btn"
                  aria-label={n.archived ? "Unarchive" : "Archive"}
                  onClick={() => {
                    if (n.archived) act({ archived: false }, "Note unarchived", { archived: true });
                    else {
                      act({ archived: true, pinned: false }, "Note archived", { archived: false, pinned: n.pinned });
                      onClose();
                    }
                  }}
                >
                  {n.archived ? <UnarchiveIcon /> : <ArchiveIcon />}
                </button>
              )}
              <button className="icon-btn" aria-label="More" onClick={(e) => more(e.currentTarget)}>
                <MoreIcon />
              </button>
            </>
          )}
        </div>

        <div className="editor-scroll">
          <textarea
            ref={titleRef}
            className="editor-title"
            dir="auto"
            placeholder="Title"
            rows={1}
            value={title}
            enterKeyHint="next"
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, " ");
              setTitle(v);
              save({ title: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                enterEdit(0);
              }
            }}
          />
          {mode === "edit" ? (
            <textarea
              ref={bodyRef}
              className="editor-body"
              dir="auto"
              placeholder="Note"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                save({ body: e.target.value });
              }}
              onKeyDown={onBodyKey}
            />
          ) : (
            <div
              className={`editor-preview md${body ? "" : " empty-preview"}`}
              onClick={onPreviewClick}
              dangerouslySetInnerHTML={{ __html: body ? html : "<p>Note</p>" }}
            />
          )}
        </div>

        <div className="editor-bottom">
          <button className="folder-btn" onClick={() => setPicking(true)}>
            <FolderIcon size={16} />
            <span>{(n?.folder ?? defaultFolder) ? baseName(n?.folder ?? defaultFolder) : "No folder"}</span>
          </button>
          <button className="when" onClick={() => setShowCreated((s) => !s)}>
            {n ? (showCreated ? `Created ${longDate(n.createdAt)}` : `Edited ${longDate(n.updatedAt)}`) : ""}
          </button>
          <button className="icon-btn" aria-label="Checklist item" onClick={toggleChecklist}>
            <CheckboxIcon />
          </button>
          <button
            className="icon-btn"
            aria-label="Add link"
            title="Add link (Ctrl/⌘ K)"
            onMouseDown={(e) => e.preventDefault()} // keep the text selection on desktop
            onClick={addLink}
          >
            <LinkIcon />
          </button>
          <button
            className="icon-btn"
            aria-label={mode === "edit" ? "Preview" : "Edit"}
            onClick={() => (mode === "edit" ? setMode("preview") : enterEdit(null))}
          >
            {mode === "edit" ? <EyeIcon /> : <EditIcon />}
          </button>
        </div>
      </div>
      {picking && (
        <FolderPicker
          folders={folders}
          current={n?.folder ?? defaultFolder}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            if (!n) {
              createNote(id, { title, body, folder: p });
              onCreated(id);
            } else updateNote(id, { folder: p }, { touch: false });
            toast(p ? `Moved to ${baseName(p)}` : "Moved out of folders");
          }}
        />
      )}
    </>
  );
}
