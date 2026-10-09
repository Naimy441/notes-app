"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { setEditSurface } from "./NoteBody";

// A tiny imperative overlay system: toast(), menu(), prompt(), confirm().

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  out?: boolean;
}
interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  run: () => void;
}
type Dialog =
  | { kind: "prompt"; title: string; message?: string; initial?: string; placeholder?: string; ok?: string; multiline?: boolean; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; message?: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "link"; text: string; url: string; resolve: (v: { text: string; url: string } | null) => void };

interface UIState {
  toasts: Toast[];
  menu: { x: number; y: number; alignRight: boolean; up: boolean; items: MenuItem[] } | null;
  dialog: Dialog | null;
}

let ui: UIState = { toasts: [], menu: null, dialog: null };
const subs = new Set<() => void>();
const set = (patch: Partial<UIState>) => {
  ui = { ...ui, ...patch };
  subs.forEach((s) => s());
};

let toastSeq = 0;
export function toast(text: string, action?: Toast["action"]) {
  const id = ++toastSeq;
  set({ toasts: [...ui.toasts.slice(-2), { id, text, action }] });
  setTimeout(() => dismissToast(id), action ? 5000 : 2600);
}
function dismissToast(id: number) {
  if (!ui.toasts.some((t) => t.id === id)) return;
  set({ toasts: ui.toasts.map((t) => (t.id === id ? { ...t, out: true } : t)) });
  setTimeout(() => set({ toasts: ui.toasts.filter((t) => t.id !== id) }), 220);
}

export function menu(anchor: Element, items: MenuItem[]) {
  const r = anchor.getBoundingClientRect();
  const alignRight = r.left + r.width / 2 > innerWidth / 2;
  const up = r.bottom > innerHeight * 0.62;
  set({
    menu: {
      x: alignRight ? innerWidth - r.right : r.left,
      y: up ? innerHeight - r.top + 4 : r.bottom + 4,
      alignRight,
      up,
      items,
    },
  });
}

export function prompt(opts: Omit<Extract<Dialog, { kind: "prompt" }>, "kind" | "resolve">) {
  return new Promise<string | null>((resolve) => set({ dialog: { kind: "prompt", ...opts, resolve } }));
}

/** Ask for a link's text and URL. Resolves null if cancelled or the URL is empty. */
export function linkPrompt(initial: { text: string; url: string }) {
  return new Promise<{ text: string; url: string } | null>((resolve) => set({ dialog: { kind: "link", ...initial, resolve } }));
}

export function confirm(opts: Omit<Extract<Dialog, { kind: "confirm" }>, "kind" | "resolve">) {
  return new Promise<boolean>((resolve) => set({ dialog: { kind: "confirm", ...opts, resolve } }));
}

function useUI() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => ui,
    () => ui,
  );
}

export function OverlayHost() {
  const { toasts, menu: m, dialog } = useUI();
  return (
    <>
      {m && (
        <div className="menu-layer" onClick={() => set({ menu: null })} onContextMenu={(e) => e.preventDefault()}>
          <div
            className="menu"
            role="menu"
            style={{
              [m.alignRight ? "right" : "left"]: m.x,
              [m.up ? "bottom" : "top"]: m.y,
              ["--origin" as string]: `${m.up ? "bottom" : "top"} ${m.alignRight ? "right" : "left"}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {m.items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className={it.danger ? "danger" : undefined}
                onClick={() => {
                  set({ menu: null });
                  it.run();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {dialog && <DialogView d={dialog} close={() => set({ dialog: null })} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.out ? " out" : ""}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function DialogView({ d, close }: { d: Dialog; close: () => void }) {
  const multiline = d.kind === "prompt" && !!d.multiline;
  const [value, setValue] = useState(d.kind === "prompt" ? (d.initial ?? "") : d.kind === "link" ? d.url : "");
  const [text, setText] = useState(d.kind === "link" ? d.text : "");
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (d.kind === "confirm") return;
    if (multiline) {
      const el = field.current;
      if (!el) return;
      el.textContent = d.kind === "prompt" ? (d.initial ?? "") : "";
      el.focus();
      return;
    }
    const el = input.current;
    el?.focus();
    el?.select();
  }, [d, multiline]);
  // Keep a prompt that is open with the keyboard fully inside the visible
  // viewport, so Cancel / Apply sit above the keyboard rather than under it.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = backdrop.current;
    if (!vv || !el) return;
    let timer = 0;
    const update = () => {
      const mobile = window.innerWidth < 700;
      const open = mobile && window.innerHeight - vv.height > 80;
      el.classList.toggle("above-kb", open);
      if (open) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = "auto";
      } else {
        el.style.top = "";
        el.style.height = "";
        el.style.bottom = "";
      }
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    const onFocus = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 60);
    };
    el.addEventListener("focusin", onFocus);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      el.removeEventListener("focusin", onFocus);
      window.clearTimeout(timer);
    };
  }, [d]);
  const finish = (ok: boolean) => {
    const typed = multiline ? (field.current?.textContent ?? "").replace(/\u00a0/g, " ") : value;
    close();
    if (d.kind === "prompt") d.resolve(ok && typed.trim() ? typed.trim() : null);
    else if (d.kind === "link") d.resolve(ok && value.trim() ? { text: text.trim(), url: value.trim() } : null);
    else d.resolve(ok);
  };
  useEffect(() => {
    if (!multiline) return;
    // The prompt is the only element with an editable style. Turning the note
    // fields back on here would give iOS a second and third assistable target.
    setEditSurface("none");
    return () => setEditSurface("none");
  }, [multiline]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return createPortal(
    <div ref={backdrop} className="sheet-backdrop" style={{ alignItems: "center" }} onClick={() => finish(false)}>
      {/* Not a form, and not an input or textarea. Those are InputType::Text /
          TextArea, which always get the accessory on iPhone. This is the only
          element left with an editable style while the prompt is open. */}
      {multiline ? (
        <div className="dialog" role="dialog" aria-label={d.kind === "prompt" ? d.title : "Edit"} onClick={(e) => e.stopPropagation()}>
          <h3>{d.kind === "prompt" ? d.title : ""}</h3>
          {d.kind === "prompt" && d.message && <p>{d.message}</p>}
          <div
            ref={field}
            className="dialog-area plain-field"
            contentEditable
            aria-label={d.kind === "prompt" ? d.placeholder || d.title : "Prompt"}
            data-placeholder={d.kind === "prompt" ? d.placeholder : undefined}
            dir="auto"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            suppressContentEditableWarning
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData.getData("text/plain");
              if (pasted) document.execCommand("insertText", false, pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                finish(true);
              }
            }}
          />
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => finish(false)}>
              Cancel
            </button>
            <button type="button" className={`btn primary`} onClick={() => finish(true)}>
              {d.kind === "prompt" ? (d.ok ?? "OK") : "OK"}
            </button>
          </div>
        </div>
      ) : (
      <form
        className="dialog"
        noValidate
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          finish(true);
        }}
      >
        <h3>{d.kind === "link" ? "Add link" : d.title}</h3>
        {d.kind !== "link" && d.message && <p>{d.message}</p>}
        {d.kind === "link" && (
          <>
            <input
              ref={input}
              type="text"
              inputMode="url"
              value={value}
              placeholder="Paste or type a URL"
              onChange={(e) => setValue(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
            <input
              value={text}
              placeholder="Text to show (optional)"
              dir="auto"
              onChange={(e) => setText(e.target.value)}
              style={{ marginTop: 10 }}
              enterKeyHint="done"
            />
          </>
        )}
        {d.kind === "prompt" && (
            <input
              ref={input}
              value={value}
              placeholder={d.placeholder}
              dir="auto"
              onChange={(e) => setValue(e.target.value)}
              autoCapitalize="words"
              enterKeyHint="done"
            />
          )}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => finish(false)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${d.kind === "confirm" && d.danger ? "danger" : "primary"}`}>
            {d.kind === "link" ? "Add" : (d.ok ?? "OK")}
          </button>
        </div>
      </form>
      )}
    </div>,
    document.body,
  );
}

/** Bottom sheet on phones, centered card on desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
