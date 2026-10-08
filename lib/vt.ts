"use client";

import { flushSync } from "react-dom";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const canVT = () =>
  typeof document !== "undefined" &&
  "startViewTransition" in document &&
  document.visibilityState === "visible" &&
  !reduced();

/** Aborted transitions (e.g. tab hidden mid-flight) still apply the update; don't surface them as errors. */
export function quiet(t: ViewTransition) {
  t.ready.catch(() => {});
  t.updateCallbackDone.catch((e) => console.error(e));
  return t;
}

/**
 * Run a React state update inside a View Transition so the browser morphs
 * between the before/after snapshots on the compositor. Falls back to an
 * instant update (CSS keyframes still play) where unsupported.
 */
export function vt(update: () => void, opts: { before?: () => void; during?: () => void; after?: () => void } = {}) {
  if (!canVT()) {
    update();
    return;
  }
  opts.before?.();
  const t = quiet(
    document.startViewTransition(() => {
      opts.during?.();
      flushSync(update);
    }),
  );
  t.finished.finally(() => opts.after?.());
  return t;
}

/** Circular reveal from the point the user tapped. */
export function themeTransition(apply: () => void, x: number, y: number) {
  if (!canVT()) return apply();
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.style.setProperty("--vt-x", `${x}px`);
  root.style.setProperty("--vt-y", `${y}px`);
  root.style.setProperty("--vt-r", `${r}px`);
  root.classList.add("theme-vt");
  const t = quiet(document.startViewTransition(() => flushSync(apply)));
  t.finished.finally(() => root.classList.remove("theme-vt"));
}
