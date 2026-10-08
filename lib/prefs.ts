"use client";

import { useSyncExternalStore } from "react";
import type { SortKey, ThemePref } from "./types";

interface Prefs {
  theme: ThemePref;
  sort: SortKey;
}

const DEFAULTS: Prefs = { theme: "system", sort: "updatedAt" };

function read(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("prefs") ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

let prefs = read();
const subs = new Set<() => void>();

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => prefs,
    () => DEFAULTS,
  );
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem("prefs", JSON.stringify(prefs));
  } catch {}
  subs.forEach((s) => s());
}

const THEME_COLORS = { light: "#f6f5f2", dark: "#141416" };

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref) {
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[t]);
}

/** Runs in <head> before first paint so there is never a flash of the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("prefs")||"{}").theme||"system";var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch(e){}})()`;

export { THEME_COLORS };
