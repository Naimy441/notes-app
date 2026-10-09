"use client";

import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { baseName, longDate } from "@/lib/derive";
import { scrollCaretIntoView } from "@/lib/editorKit";
import { getAuthInstance } from "@/lib/firebase";
import { createNote, discardNote, flushPending, newNoteId, purgeNotes, updateNote, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import { FolderPicker } from "./FolderPicker";
import { NoteBody, setRemoteText } from "./NoteBody";
import {
  ArchiveIcon,
  BackIcon,
  CheckboxIcon,
  CopyIcon,
  FolderIcon,
  LinkIcon,
  MoreIcon,
  PinFilledIcon,
  PinIcon,
  PromptIcon,
  RestoreIcon,
  SparkIcon,
  TrashIcon,
  UnarchiveIcon,
  UndoIcon,
} from "./icons";
import { confirm, linkPrompt, menu, prompt, toast } from "./overlays";

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

/** iOS shows a checkmark and arrows above the keyboard for text fields. Refocusing past a readonly moment drops that bar. */
function focusTitleWithoutAccessory(el: HTMLTextAreaElement, event: React.PointerEvent<HTMLTextAreaElement>) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios || document.activeElement === el) return;
  event.preventDefault();
  el.readOnly = true;
  el.setAttribute("inputmode", "none");
  el.focus();
  window.setTimeout(() => {
    el.readOnly = false;
    el.setAttribute("inputmode", "text");
    el.focus();
  }, 40);
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Fit the sheet to the visual viewport while the keyboard is open, and keep the caret above it. */
function useVisualViewport(ref: React.RefObject<HTMLElement | null>, onInset: () => void) {
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer = 0;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const mobile = window.innerWidth < 700;
      const open = mobile && window.innerHeight - vv.height > 120;
      if (open) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = "auto";
        if (window.scrollY) window.scrollTo(0, 0);
      } else {
        el.style.top = "";
        el.style.height = "";
        el.style.bottom = "";
      }
      setKb(open);
      if (mobile) {
        window.clearTimeout(timer);
        timer = window.setTimeout(onInset, open ? 60 : 0);
      }
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.clearTimeout(timer);
    };
  }, [ref, onInset]);
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
  const [showCreated, setShowCreated] = useState(false);
  const [picking, setPicking] = useState(false);

  const sheet = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const view = useRef<EditorView | null>(null);
  const [initialBody] = useState(body);
  const [aiUndo, setAiUndo] = useState<{ title: string; body: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const revealCaret = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && sheet.current?.contains(active)) {
      const scroller = active.closest(".editor-scroll");
      if (scroller instanceof HTMLElement) {
        const caret = active.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        if (caret.bottom > box.bottom - 28) scroller.scrollTop += caret.bottom - (box.bottom - 28);
        else if (caret.top < box.top + 12) scroller.scrollTop -= box.top + 12 - caret.top;
      }
      return;
    }
    scrollCaretIntoView(view.current);
  }, []);
  const kb = useVisualViewport(sheet, revealCaret);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const onFocus = () => window.setTimeout(revealCaret, 320);
    el.addEventListener("focusin", onFocus);
    return () => el.removeEventListener("focusin", onFocus);
  }, [revealCaret]);

  // Pull in edits from other devices unless the user is typing in that field.
  const remoteBody = note?.body;
  const remoteTitle = note?.title;
  useEffect(() => {
    const v = view.current;
    if (remoteBody === undefined || !v || v.hasFocus) return;
    setRemoteText(v, remoteBody);
    setBody(remoteBody);
  }, [remoteBody]);
  useEffect(() => {
    if (remoteTitle !== undefined && document.activeElement !== titleRef.current) setTitle(remoteTitle);
  }, [remoteTitle]);

  useLayoutEffect(() => autosize(titleRef.current), [title]);
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

  /** Put the cursor in the note body at `pos` (default: the end). */
  const focusBody = (pos?: number) => {
    const v = view.current;
    if (!v) return;
    v.focus();
    const at = Math.min(pos ?? v.state.doc.length, v.state.doc.length);
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  };

  const addLink = async () => {
    const v = view.current;
    if (!v) return;
    const focused = v.hasFocus;
    const { from, to } = focused ? v.state.selection.main : { from: v.state.doc.length, to: v.state.doc.length };
    const selected = v.state.sliceDoc(from, to);
    const selIsUrl = /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(selected);
    const res = await linkPrompt({ text: selIsUrl ? "" : selected.trim(), url: selIsUrl ? selected.trim() : "" });
    if (!res) {
      if (focused) v.focus();
      return;
    }
    let md = markdownLink(res.text, res.url);
    // Appending to a note that wasn't being edited: start the link on its own line.
    if (!focused && v.state.doc.length && !v.state.doc.toString().endsWith("\n")) md = "\n" + md;
    v.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length }, scrollIntoView: true });
    v.focus();
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

  /** Toggle "- [ ] " on the current line; if the note isn't being edited, add a new checklist item at the end. */
  const toggleChecklist = () => {
    const v = view.current;
    if (!v) return;
    if (!v.hasFocus) {
      const doc = v.state.doc.toString();
      const insert = (doc && !doc.endsWith("\n") ? "\n" : "") + "- [ ] ";
      v.dispatch({ changes: { from: doc.length, insert }, selection: { anchor: doc.length + insert.length }, scrollIntoView: true });
      v.focus();
      return;
    }
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const task = /^(\s*)[-*+]\s+\[[ xX]\]\s?/.exec(line.text);
    const plain = /^(\s*)(?:[-*+]\s+)?/.exec(line.text)!;
    const change = task
      ? { from: line.from + task[1].length, to: line.from + task[0].length, insert: "" }
      : { from: line.from + plain[1].length, to: line.from + plain[0].length, insert: "- [ ] " };
    v.dispatch({ changes: change });
    v.focus();
  };

  const applyText = (next: { title: string; body: string }) => {
    setTitle(next.title);
    setBody(next.body);
    const v = view.current;
    if (v && v.state.doc.toString() !== next.body) {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: next.body },
        selection: { anchor: next.body.length },
      });
    }
    save({ title: next.title, body: next.body });
  };

  const runAi = async (instruction: string | null) => {
    if (aiBusy) return;
    if (!instruction && !title.trim() && !body.trim()) {
      toast("Nothing to edit");
      return;
    }
    const before = { title, body };
    setAiBusy(true);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title, body, instruction }),
      });
      const data = (await res.json().catch(() => ({}))) as { title?: unknown; body?: unknown; error?: string };
      if (!res.ok || typeof data.title !== "string" || typeof data.body !== "string") {
        throw new Error(data.error || "AI edit failed");
      }
      applyText({ title: data.title, body: data.body });
      setAiUndo(before);
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI edit failed");
    } finally {
      setAiBusy(false);
    }
  };

  const promptAi = async () => {
    const text = await prompt({
      title: "Edit with AI",
      message: "Describe the change. Arabic words written in Latin letters are left as written.",
      placeholder: "Make this a checklist",
      ok: "Apply",
      multiline: true,
    });
    if (text) runAi(text);
  };

  const undoAi = () => {
    if (!aiUndo) return;
    applyText(aiUndo);
    setAiUndo(null);
    toast("AI edit undone");
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
          <div className="editor-nav">
            <button className="icon-btn" aria-label="Back" onClick={close}>
              <BackIcon />
            </button>
            <button className="folder-btn" onClick={() => setPicking(true)}>
              <FolderIcon size={16} />
              <span>{(n?.folder ?? defaultFolder) ? baseName(n?.folder ?? defaultFolder) : "No folder"}</span>
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
          <div className="editor-tools">
            <button
              className="icon-btn"
              aria-label="Checklist item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleChecklist}
            >
              <CheckboxIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Add link"
              title="Add link (Ctrl/⌘ K)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addLink}
            >
              <LinkIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Format and fix spelling"
              title="Format and fix spelling"
              disabled={aiBusy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runAi(null)}
            >
              <SparkIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Edit with AI"
              title="Edit with a prompt"
              disabled={aiBusy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={promptAi}
            >
              <PromptIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Undo AI edit"
              title="Undo AI edit"
              disabled={!aiUndo || aiBusy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={undoAi}
            >
              <UndoIcon />
            </button>
            <div className="spacer" />
            <button className="when" onClick={() => setShowCreated((s) => !s)}>
              {n ? (showCreated ? `Created ${longDate(n.createdAt)}` : `Edited ${longDate(n.updatedAt)}`) : ""}
            </button>
          </div>
        </div>

        <div className="editor-scroll">
          <textarea
            ref={titleRef}
            className="editor-title"
            dir="auto"
            placeholder="Title"
            rows={1}
            value={title}
            spellCheck={false}
            enterKeyHint="next"
            autoCorrect="on"
            onPointerDown={(e) => focusTitleWithoutAccessory(e.currentTarget, e)}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, " ");
              setTitle(v);
              save({ title: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                focusBody(0);
              }
            }}
          />
          <NoteBody
            initial={initialBody}
            onChange={(text) => {
              setBody(text);
              save({ body: text });
            }}
            onWikilink={onWikilink}
            onModEnter={() => close()}
            onReady={(v) => {
              view.current = v;
            }}
          />
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
