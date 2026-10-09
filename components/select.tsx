"use client";

import { createContext, useContext } from "react";

export interface SelectApi {
  on: boolean;
  ids: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** Enter selection with this note already chosen (long-press). */
  arm: (id: string) => void;
}

const Ctx = createContext<SelectApi | null>(null);

export const SelectProvider = Ctx.Provider;

export function useSelect() {
  return useContext(Ctx);
}
