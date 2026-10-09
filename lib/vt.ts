"use client";

import { flushSync } from "react-dom";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const canVT = () =>
  typeof document !== "undefined" &&
  "startViewTransition" in document &&
  document.visibilityState === "visible" &&
  !reduced();

/**
 * Card-to-sheet morphs. On a phone the first transition snapshots a half-laid-out
 * fixed sheet and flashes the list behind it, so mobile opens with a plain cover.
 */
export const canMorphNote = () =>
  canVT() && window.matchMedia("(min-width: 700px) and (pointer: fine)").matches;

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

/**
 * Shrink the open sheet onto its card.
 * A view transition only crossfades the snapshots, and with the body position-fixed
 * for the scroll lock those snapshots don't share a coordinate space, so the group
 * jumps. Animating the sheet's own transform uses the two visual rects directly.
 */
export function morphSheetToCard(sheet: HTMLElement, card: DOMRect, backdrop: HTMLElement | null): Animation {
  const from = sheet.getBoundingClientRect();
  // Desktop lays the sheet out at left:50% with transform:translateX(-50%).
  // Scaling that box keeps the percentage translate, so the left edge walks
  // right as the width drops and the sheet misses the card. Park the border
  // box on the pixels already on screen and animate from a clean transform.
  sheet.classList.add("vt");
  sheet.getAnimations().forEach((anim) => anim.cancel());
  const style = sheet.style;
  style.animation = "none";
  style.boxSizing = "border-box";
  style.left = `${from.left}px`;
  style.top = `${from.top}px`;
  style.width = `${from.width}px`;
  style.height = `${from.height}px`;
  style.right = "auto";
  style.bottom = "auto";
  style.margin = "0";
  style.maxHeight = "none";
  style.transform = "none";
  style.transformOrigin = "0px 0px";
  style.overflow = "hidden";
  style.pointerEvents = "none";

  const pinned = sheet.getBoundingClientRect();
  const sx = card.width / pinned.width;
  const sy = card.height / pinned.height;
  const radius = getComputedStyle(sheet).borderTopLeftRadius || "0px";
  // Keyframes repeat the pin: a re-render can clear the inline styles, and a
  // stylesheet transform must not composite back in while the width changes.
  const pin = {
    animation: "none",
    boxSizing: "border-box",
    left: `${pinned.left}px`,
    top: `${pinned.top}px`,
    width: `${pinned.width}px`,
    height: `${pinned.height}px`,
    right: "auto",
    bottom: "auto",
    margin: "0",
    maxHeight: "none",
    transformOrigin: "0px 0px",
    overflow: "hidden",
    pointerEvents: "none",
  };

  backdrop?.animate([{ opacity: 1 }, { opacity: 0, pointerEvents: "none" }], {
    duration: 280,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    fill: "forwards",
  });

  return sheet.animate(
    [
      { ...pin, transform: "none", borderRadius: radius },
      {
        ...pin,
        transform: `translate(${card.left - pinned.left}px, ${card.top - pinned.top}px) scale(${sx}, ${sy})`,
        borderRadius: "18px",
      },
    ],
    { duration: 380, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
  );
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
