"use client";

import { useSyncExternalStore } from "react";

export type View = "notes" | "folders" | "archive" | "trash";

export interface Route {
  view: View;
  /** Folder path when view === "folders"; "" is the top level. */
  folder: string;
  /** Open note id, or "new" / "new:checklist" for a fresh draft. */
  note: string | null;
  /** Search query; non-null means search mode is open. */
  q: string | null;
}

const VIEWS: View[] = ["notes", "folders", "archive", "trash"];

function parse(): Route {
  if (typeof window === "undefined") return { view: "notes", folder: "", note: null, q: null };
  const sp = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const v = sp.get("v") as View | null;
  let view: View = v && VIEWS.includes(v) ? v : "notes";
  if (!v) {
    try {
      const last = localStorage.getItem("view") as View | null;
      if (last === "folders") view = "folders";
    } catch {}
  }
  return { view, folder: sp.get("f") ?? "", note: hash.get("n"), q: sp.get("q") };
}

function toUrl(r: Route) {
  const sp = new URLSearchParams();
  sp.set("v", r.view);
  if (r.view === "folders" && r.folder) sp.set("f", r.folder);
  if (r.q !== null) sp.set("q", r.q);
  return `?${sp.toString()}${r.note ? `#n=${encodeURIComponent(r.note)}` : ""}`;
}

let route: Route = parse();
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    route = parse();
    notify();
  });
  // Mark the entry we launched on, so we know whether "back" stays inside the app.
  if (!history.state?.app) history.replaceState({ app: true, depth: 0 }, "");
}

export function getRoute() {
  return route;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => route,
    () => route,
  );
}

export function navigate(patch: Partial<Route>, opts: { replace?: boolean } = {}) {
  const next: Route = { ...route, ...patch };
  if (patch.view && patch.view !== route.view && patch.folder === undefined) next.folder = "";
  route = next;
  if (next.view === "notes" || next.view === "folders") {
    try {
      localStorage.setItem("view", next.view);
    } catch {}
  }
  const depth = (history.state?.depth ?? 0) + (opts.replace ? 0 : 1);
  if (opts.replace) history.replaceState({ app: true, depth }, "", toUrl(next));
  else history.pushState({ app: true, depth }, "", toUrl(next));
  notify();
}

/**
 * Go back if the previous entry is ours; otherwise apply `fallback` in place.
 * Resolves once the route has actually changed (popstate is async).
 */
export function back(fallback: Partial<Route>): Promise<void> {
  if ((history.state?.depth ?? 0) > 0) {
    return new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("popstate", done);
        clearTimeout(timer);
        // Let the router's own popstate listener run first.
        queueMicrotask(resolve);
      };
      const timer = setTimeout(done, 400);
      window.addEventListener("popstate", done);
      history.back();
    });
  }
  navigate(fallback, { replace: true });
  return Promise.resolve();
}
