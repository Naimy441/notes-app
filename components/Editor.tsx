"use client";

import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { baseName, longDate } from "@/lib/derive";
import { Dictation, canDictate, type DictationLang, type DictationPhase } from "@/lib/dictation";
import { beginDictation, endDictation, insertPhrase, revealDictation, showInterim } from "@/lib/dictationEditor";
import { scrollCaretIntoView } from "@/lib/editorKit";
import { getAuthInstance } from "@/lib/firebase";
import { setPref, usePrefs } from "@/lib/prefs";
import { createNote, discardNote, flushPending, newNoteId, purgeNotes, updateNote, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import { FolderPicker } from "./FolderPicker";
import { NoteBody, setEditSurface, setRemoteText, useEditSurface } from "./NoteBody";
import {
  ArchiveIcon,
  BackIcon,
  CopyIcon,
  FolderIcon,
  LinkIcon,
  MicIcon,
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
  /** Existing note id, or "new" for a fresh draft. */
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

const BLOCKED_KEY = "dictation-blocked";
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {}
};

const LANG_LABEL: Record<DictationLang, string> = { auto: "Auto", en: "EN", ar: "ع" };
const LANG_NEXT: Record<DictationLang, DictationLang> = { auto: "en", en: "ar", ar: "auto" };
const LANG_NAME: Record<DictationLang, string> = { auto: "Automatic language", en: "English", ar: "Arabic" };

/**
 * Fit the sheet to the keyboard when it opens or closes.
 * Visual-viewport scroll events are the browser chasing the caret; moving the
 * sheet with them throws the whole note upward, especially after a paste.
 */
function useVisualViewport(ref: React.RefObject<HTMLElement | null>, onInset: () => void) {
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer = 0;
    const place = () => {
      const el = ref.current;
      if (!el) return false;
      // Don't clear top/height while a card↔sheet morph has the sheet pinned.
      if (el.classList.contains("vt")) return false;
      const mobile = window.innerWidth < 700;
      const open = mobile && window.innerHeight - vv.height > 120;
      if (open) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = "auto";
      } else {
        el.style.top = "";
        el.style.height = "";
        el.style.bottom = "";
      }
      setKb(open);
      return open;
    };
    const onResize = () => {
      const open = place();
      if (window.innerWidth >= 700) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(onInset, open ? 60 : 0);
    };
    place();
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [ref, onInset]);
  return kb;
}

export function Editor({ noteId, defaultFolder, folders, vtName, closing, onClose, onCreated, onWikilink }: Props) {
  const { notes } = useStore();
  const prefs = usePrefs();
  const isNew = noteId.startsWith("new");
  const [id] = useState(() => (isNew ? newNoteId() : noteId));
  const note: Note | undefined = notes.get(id);
  const created = !!note;

  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [showCreated, setShowCreated] = useState(false);
  const [picking, setPicking] = useState(false);

  const sheet = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [initialBody] = useState(body);
  const [aiUndo, setAiUndo] = useState<{ title: string; body: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // ── keep the caret (or the dictation point) on screen ────────────────────
  const revealCaret = useCallback(() => {
    const active = document.activeElement;
    // The title is a short field, so its own rect is the line being edited.
    if (active instanceof HTMLElement && active === titleRef.current) {
      const scroller = active.closest(".editor-scroll");
      if (scroller instanceof HTMLElement) {
        const box = scroller.getBoundingClientRect();
        const caret = active.getBoundingClientRect();
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

  // ── edits from other devices ──────────────────────────────────────────────
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

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || document.activeElement === el) return;
    if ((el.textContent ?? "") !== title) el.textContent = title;
  }, [title]);

  // ── one editable surface at a time (see NoteBody.tsx) ────────────────────
  const surface = useEditSurface();
  const seeded = useRef(false);
  useLayoutEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setEditSurface(isNew ? "title" : "none");
  }, [isNew]);
  useEffect(() => () => setEditSurface("none"), []);
  useEffect(() => {
    if (!isNew || surface !== "title") return;
    titleRef.current?.focus({ preventScroll: true });
  }, [isNew, surface]);
  useEffect(() => {
    const root = sheet.current;
    if (!root) return;
    const arm = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || root.classList.contains("ai-busy")) return;
      if (t.closest(".editor-title")) flushSync(() => setEditSurface("title"));
      else if (t.closest(".note-body")) flushSync(() => setEditSurface("body"));
    };
    root.addEventListener("pointerdown", arm, true);
    root.addEventListener("touchstart", arm, true);
    return () => {
      root.removeEventListener("pointerdown", arm, true);
      root.removeEventListener("touchstart", arm, true);
    };
  }, []);

  // ── saving ────────────────────────────────────────────────────────────────
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

  const dictation = useRef<Dictation | null>(null);
  const close = useCallback(() => {
    dictation.current?.stop();
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
      if (e.key !== "Escape" || picking || document.querySelector(".menu-layer, .dialog")) return;
      e.preventDefault();
      if (dictation.current) dictation.current.stop();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, picking]);

  /** Put the cursor in the note body at `pos` (default: the end). */
  const focusBody = (pos?: number) => {
    const v = view.current;
    if (!v || aiBusy) return;
    flushSync(() => setEditSurface("body"));
    v.focus();
    const at = Math.min(pos ?? v.state.doc.length, v.state.doc.length);
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  };

  const focusBodyRef = useRef(focusBody);
  useLayoutEffect(() => {
    focusBodyRef.current = focusBody;
  });

  // ── links ─────────────────────────────────────────────────────────────────
  const addLink = async () => {
    const v = view.current;
    if (!v || aiBusy) return;
    const focused = v.hasFocus;
    const { from, to } = focused ? v.state.selection.main : { from: v.state.doc.length, to: v.state.doc.length };
    const selected = v.state.sliceDoc(from, to);
    const selIsUrl = /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(selected);
    const res = await linkPrompt({ text: selIsUrl ? "" : selected.trim(), url: selIsUrl ? selected.trim() : "" });
    if (!res) {
      if (focused) focusBody(v.state.selection.main.head);
      return;
    }
    let md = markdownLink(res.text, res.url);
    if (!focused && v.state.doc.length && !v.state.doc.toString().endsWith("\n")) md = "\n" + md;
    v.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length }, scrollIntoView: true });
    focusBody(from + md.length);
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

  // ── dictation ─────────────────────────────────────────────────────────────
  const [dict, setDict] = useState<{ phase: DictationPhase } | null>(null);
  const keepDictationInView = () => {
    const v = view.current;
    if (v && !v.hasFocus) revealDictation(v);
  };
  const startDictation = () => {
    const v = view.current;
    if (!v || aiBusy || dictation.current) return;
    if (!canDictate()) {
      // The keyboard's own mic is the same built-in dictation; bring the keyboard up.
      toast("Use the mic on your keyboard to dictate.");
      focusBody();
      return;
    }
    // If recognition was refused here before (common in iOS home-screen apps),
    // raise the keyboard now, inside the tap: iOS ignores focus that comes later,
    // and the keyboard's mic is the fallback. Recognition is still tried.
    if (readFlag(BLOCKED_KEY)) focusBody();
    beginDictation(v);
    const d = new Dictation(
      {
        interim: (text) => {
          if (!view.current) return;
          showInterim(view.current, text);
          keepDictationInView();
        },
        final: (text) => {
          if (!view.current) return;
          writeFlag(BLOCKED_KEY, false);
          insertPhrase(view.current, text);
          requestAnimationFrame(keepDictationInView);
        },
        phase: (phase) => setDict({ phase }),
        ended: (result) => {
          if (dictation.current === d) dictation.current = null;
          setDict(null);
          if (view.current) endDictation(view.current);
          if (result) {
            toast(result.error);
            if (result.useKeyboard) {
              writeFlag(BLOCKED_KEY, true);
              focusBodyRef.current();
            }
          }
        },
      },
      prefs.dictationLang,
    );
    dictation.current = d;
    setDict({ phase: "starting" });
    // Must run inside the tap: iOS only starts the recognizer and the mic from a user gesture.
    d.start();
  };
  const stopDictation = () => dictation.current?.stop();
  const cycleLang = () => {
    const next = LANG_NEXT[prefs.dictationLang];
    setPref("dictationLang", next);
    dictation.current?.setLang(next);
  };
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") dictation.current?.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      dictation.current?.stop();
    };
  }, []);

  // ── AI ────────────────────────────────────────────────────────────────────
  const applyText = (next: { title: string; body: string }) => {
    setTitle(next.title);
    setBody(next.body);
    const v = view.current;
    if (v && v.state.doc.toString() !== next.body) {
      // A normal (undoable) transaction, so ⌘Z / Ctrl+Z also reverts an AI edit.
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next.body }, userEvent: "input.ai" });
    }
    save({ title: next.title, body: next.body });
  };

  const runAi = async (instruction: string | null) => {
    if (aiBusy) return;
    if (!instruction && !title.trim() && !body.trim()) return toast("Nothing to tidy yet");
    if (!navigator.onLine) return toast("AI needs a connection");
    dictation.current?.stop();
    const before = { title, body };
    // Lock the note while the AI works, so nothing typed meanwhile gets overwritten.
    setEditSurface("none");
    (document.activeElement as HTMLElement | null)?.blur?.();
    setAiBusy(true);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title, body, instruction }),
      });
      const data = (await res.json().catch(() => ({}))) as { title?: unknown; body?: unknown; error?: string };
      if (!res.ok || typeof data.title !== "string" || typeof data.body !== "string") throw new Error(data.error || "AI edit failed");
      if (data.title === before.title && data.body.trimEnd() === before.body.trimEnd()) {
        toast(instruction ? "The AI made no changes" : "Already tidy — nothing to change");
        return;
      }
      applyText({ title: data.title, body: data.body });
      setAiUndo(before);
      toast(instruction ? "AI edit applied" : "Tidied spelling and formatting", { label: "Undo", run: () => undoAiRef.current() });
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI edit failed");
    } finally {
      setAiBusy(false);
    }
  };

  const promptAi = async () => {
    const text = await prompt({
      title: "Edit with AI",
      message: "Say what to change. Arabic and transliterated words are left as they are.",
      placeholder: "e.g. Turn this into a checklist",
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
  const undoAiRef = useRef(undoAi);
  useLayoutEffect(() => {
    undoAiRef.current = undoAi;
  });

  const aiMenu = (anchor: HTMLElement) => {
    menu(anchor, [
      { label: "Fix spelling & format", icon: <SparkIcon size={20} />, run: () => runAi(null) },
      { label: "Edit with a prompt…", icon: <PromptIcon size={20} />, run: promptAi },
      ...(aiUndo ? [{ label: "Undo AI edit", icon: <UndoIcon size={20} />, run: undoAi }] : []),
    ]);
  };

  // ── note actions ──────────────────────────────────────────────────────────
  const n = note;
  const act = (patch: Partial<Note>, msg: string, undo: Partial<Note>) => {
    if (!n) return;
    updateNote(id, patch, { touch: false });
    toast(msg, { label: "Undo", run: () => updateNote(id, undo, { touch: false }) });
  };

  const more = (anchor: HTMLElement) => {
    type Item = { label: string; icon: React.ReactNode; danger?: boolean; run: () => void };
    const items: Item[] = [
      { label: "Add link", icon: <LinkIcon size={20} />, run: addLink },
      { label: "Move to folder", icon: <FolderIcon size={20} />, run: () => setPicking(true) },
      {
        label: "Copy text",
        icon: <CopyIcon size={20} />,
        run: () => {
          navigator.clipboard.writeText([title, body].filter(Boolean).join("\n\n")).then(
            () => toast("Copied"),
            () => toast("Couldn't copy"),
          );
        },
      },
    ];
    if (n && !n.deleted) {
      items.push(
        n.archived
          ? { label: "Unarchive", icon: <UnarchiveIcon size={20} />, run: () => act({ archived: false }, "Note unarchived", { archived: true }) }
          : {
              label: "Archive",
              icon: <ArchiveIcon size={20} />,
              run: () => {
                act({ archived: true, pinned: false }, "Note archived", { archived: false, pinned: n.pinned });
                close();
              },
            },
        {
          label: "Delete",
          icon: <TrashIcon size={20} />,
          danger: true,
          run: () => {
            act({ deleted: true }, "Note moved to trash", { deleted: false });
            close();
          },
        },
      );
    } else if (n?.deleted) {
      items.push(
        { label: "Restore", icon: <RestoreIcon size={20} />, run: () => act({ deleted: false }, "Note restored", { deleted: true }) },
        {
          label: "Delete forever",
          icon: <TrashIcon size={20} />,
          danger: true,
          run: async () => {
            if (await confirm({ title: "Delete forever?", message: "This can't be undone.", ok: "Delete", danger: true })) {
              purgeNotes([id]);
              onClose();
            }
          },
        },
      );
    }
    menu(anchor, items);
  };

  const folder = n?.folder ?? defaultFolder;
  const listening = !!dict;
  const phaseLabel = !dict ? "" : dict.phase === "starting" ? "Starting…" : "Listening";

  return (
    <>
      <div className={`editor-backdrop${vtName ? " vt" : ""}${closing ? " closing" : ""}`} onClick={close} />
      <div
        ref={sheet}
        className={`editor${vtName ? " vt" : ""}${closing ? " closing" : ""}${kb ? " kb" : ""}${aiBusy ? " ai-busy" : ""}`}
        role="dialog"
        aria-label={title || "Note"}
      >
        <div className="editor-top">
          <button className="icon-btn" aria-label="Back" onClick={close}>
            <BackIcon />
          </button>
          <button className="folder-btn" onClick={() => setPicking(true)} title={folder || "No folder"}>
            <FolderIcon size={16} />
            <span>{folder ? baseName(folder) : "No folder"}</span>
          </button>
          <div className="spacer" />
          {listening ? (
            <>
              <button className="lang-chip" onClick={cycleLang} onMouseDown={(e) => e.preventDefault()} aria-label={`Dictation language: ${LANG_NAME[prefs.dictationLang]}. Tap to change.`} title={LANG_NAME[prefs.dictationLang]}>
                {LANG_LABEL[prefs.dictationLang]}
              </button>
              <button
                className={`dictate-pill ${dict.phase}`}
                onClick={stopDictation}
                onMouseDown={(e) => e.preventDefault()}
                aria-label="Stop dictation"
              >
                <span className="dictate-dot" aria-hidden="true" />
                {phaseLabel}
              </button>
            </>
          ) : (
            <>
              <button
                className="icon-btn"
                aria-label="Dictate"
                title="Dictate"
                disabled={aiBusy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={startDictation}
              >
                <MicIcon />
              </button>
              <button
                className={`icon-btn${aiBusy ? " busy" : ""}`}
                aria-label={aiBusy ? "AI is editing" : "AI"}
                title="AI"
                disabled={aiBusy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => aiMenu(e.currentTarget)}
              >
                <SparkIcon />
              </button>
              {n && (
                <button
                  className={`icon-btn${n.pinned ? " on" : ""}`}
                  aria-label={n.pinned ? "Unpin" : "Pin"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateNote(id, { pinned: !n.pinned }, { touch: false })}
                >
                  {n.pinned ? <PinFilledIcon /> : <PinIcon />}
                </button>
              )}
            </>
          )}
          <button className="icon-btn" aria-label="More" onMouseDown={(e) => e.preventDefault()} onClick={(e) => more(e.currentTarget)}>
            <MoreIcon />
          </button>
        </div>

        <div
          className="editor-scroll"
          onClick={(e) => {
            // Tapping the blank space under the note continues it, like a paper page.
            const t = e.target as HTMLElement;
            if (t === e.currentTarget || t.classList.contains("editor-tail")) focusBody();
          }}
        >
          <div
            ref={titleRef}
            className="editor-title"
            contentEditable={surface === "title" && !aiBusy}
            aria-label="Title"
            data-placeholder="Title"
            dir="auto"
            spellCheck={false}
            autoCorrect="on"
            suppressContentEditableWarning
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ").trim();
              if (text) document.execCommand("insertText", false, text);
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              const v = (el.textContent ?? "").replace(/\n/g, " ");
              if (!v) el.replaceChildren();
              else if ((el.textContent ?? "") !== v) el.textContent = v;
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
          <div className="editor-tail">
            {n && (
              <button className="editor-meta" onClick={() => setShowCreated((s) => !s)}>
                {showCreated ? `Created ${longDate(n.createdAt)}` : `Edited ${longDate(n.updatedAt)}`}
              </button>
            )}
          </div>
        </div>
        {aiBusy && (
          <div className="ai-working" role="status">
            <SparkIcon size={16} />
            AI is editing…
          </div>
        )}
      </div>
      {picking && (
        <FolderPicker
          folders={folders}
          current={folder}
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
