"use client";

import { flushSync } from "react-dom";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MORPH_MS = 380;

export const canVT = () =>
  typeof document !== "undefined" &&
  "startViewTransition" in document &&
  document.visibilityState === "visible" &&
  !reduced();

/**
 * Card-to-sheet morphs. On a phone the first transition snapshots a half-laid-out
 * fixed sheet and flashes the list behind it, so mobile opens with a plain cover.
 * Morphs use WAAPI geometry (not view-transition snapshots or non-uniform scale),
 * so they don't need the View Transition API.
 */
export const canMorphNote = () =>
  typeof window !== "undefined" &&
  !reduced() &&
  window.matchMedia("(min-width: 700px) and (pointer: fine)").matches;

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

type Pin = {
  animation: string;
  boxSizing: string;
  left: string;
  top: string;
  width: string;
  height: string;
  right: string;
  bottom: string;
  margin: string;
  maxHeight: string;
  transform: string;
  transformOrigin: string;
  overflow: string;
  pointerEvents: string;
};

/** Park the sheet on pixel geometry so left:50%/translateX(-50%) can't drift mid-morph. */
function pinSheet(sheet: HTMLElement, box: DOMRect): Pin {
  sheet.classList.add("vt");
  sheet.getAnimations().forEach((anim) => anim.cancel());
  const style = sheet.style;
  const pin: Pin = {
    animation: "none",
    boxSizing: "border-box",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    right: "auto",
    bottom: "auto",
    margin: "0",
    maxHeight: "none",
    transform: "none",
    transformOrigin: "0px 0px",
    overflow: "hidden",
    pointerEvents: "none",
  };
  Object.assign(style, pin);
  return pin;
}

/**
 * Drop inline morph pins so stylesheet layout owns the sheet again.
 * Leaves the `.vt` class in place — removing it would re-trigger modal-in.
 */
export function clearSheetPin(sheet: HTMLElement) {
  const style = sheet.style;
  for (const prop of [
    "animation",
    "box-sizing",
    "left",
    "top",
    "width",
    "height",
    "right",
    "bottom",
    "margin",
    "max-height",
    "transform",
    "transform-origin",
    "overflow",
    "pointer-events",
    "border-radius",
  ]) {
    style.removeProperty(prop);
  }
}

/**
 * Grow the sheet out of its card.
 * Animates the border box (left/top/width/height) instead of scale(), so the
 * note content is clipped as the window opens — not stretched or zoomed.
 */
export function morphCardToSheet(sheet: HTMLElement, card: DOMRect): Animation {
  // Measure the laid-out destination before overriding geometry. Desktop uses
  // left:50% + translateX(-50%); getBoundingClientRect is the visual box.
  const to = sheet.getBoundingClientRect();
  const radius = getComputedStyle(sheet).borderTopLeftRadius || "20px";
  const fromPin = pinSheet(sheet, card);
  const toPin: Pin = {
    ...fromPin,
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
  };

  return sheet.animate(
    [
      { ...fromPin, borderRadius: "18px" },
      { ...toPin, borderRadius: radius },
    ],
    { duration: MORPH_MS, easing: EASE, fill: "forwards" },
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
