"use client";

import { flushSync } from "react-dom";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const canVT = () =>
  typeof document !== "undefined" &&
  "startViewTransition" in document &&
  document.visibilityState === "visible" &&
  !reduced();

/** Wide layouts float the note over the list, so it can grow out of its card and shrink back into it. */
export const canMorphNote = () =>
  typeof window !== "undefined" && !reduced() && window.matchMedia("(min-width: 700px)").matches;

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

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * An empty sheet-colored surface that travels between a card and the open
 * note. Only this box is scaled: the note's own text and buttons fade in or
 * out in place, so nothing in the sheet gets squashed on the way. It sits
 * under the sheet (z-index between the backdrop and the editor) and animates
 * only transform and opacity, so it stays smooth while the main thread is busy
 * mounting or unmounting the editor.
 */
export class MorphSurface {
  readonly el: HTMLElement;
  private sheet: DOMRect;

  constructor(sheet: DOMRect) {
    this.sheet = sheet;
    const el = document.createElement("div");
    el.className = "morph-surface";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      left: `${sheet.left}px`,
      top: `${sheet.top}px`,
      width: `${sheet.width}px`,
      height: `${sheet.height}px`,
    });
    document.body.append(el);
    this.el = el;
  }

  private toCard(card: DOMRect) {
    const s = this.sheet;
    return `translate(${card.left - s.left}px, ${card.top - s.top}px) scale(${card.width / s.width}, ${card.height / s.height})`;
  }

  /** Grow from the card to the sheet. */
  open(card: DOMRect, duration = 300) {
    return this.run([{ transform: this.toCard(card), opacity: 0.6 }, { transform: "none", opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1 }], duration, EASE);
  }

  /**
   * Shrink from the sheet onto the card, fading out as it lands. Eases in, so
   * it stays put for the moment the note's text takes to fade off it.
   */
  close(card: DOMRect, duration = 340) {
    return this.run(
      [
        { transform: "none", opacity: 1 },
        { transform: this.toCard(card), opacity: 1, offset: 0.75 },
        { transform: this.toCard(card), opacity: 0 },
      ],
      duration,
      "cubic-bezier(0.4, 0, 0.2, 1)",
    );
  }

  /** No card to go to: just fade away where the sheet was. */
  fade(duration = 200) {
    return this.run([{ opacity: 1 }, { opacity: 0 }], duration, "ease");
  }

  private run(frames: Keyframe[], duration: number, easing: string): Promise<void> {
    const anim = this.el.animate(frames, { duration, easing, fill: "forwards" });
    return anim.finished.then(
      () => {},
      () => {},
    );
  }

  remove() {
    this.el.remove();
  }
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
