"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  | { kind: "prompt"; title: string; message?: string; initial?: string; placeholder?: string; ok?: string; resolve: (v: string | null) => void }
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
  const [value, setValue] = useState(d.kind === "prompt" ? (d.initial ?? "") : d.kind === "link" ? d.url : "");
  const [text, setText] = useState(d.kind === "link" ? d.text : "");
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (d.kind !== "confirm") {
      input.current?.focus();
      input.current?.select();
    }
  }, [d]);
  const finish = (ok: boolean) => {
    close();
    if (d.kind === "prompt") d.resolve(ok && value.trim() ? value.trim() : null);
    else if (d.kind === "link") d.resolve(ok && value.trim() ? { text: text.trim(), url: value.trim() } : null);
    else d.resolve(ok);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return createPortal(
    <div className="sheet-backdrop" style={{ alignItems: "center" }} onClick={() => finish(false)}>
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
