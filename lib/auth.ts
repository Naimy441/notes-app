"use client";

import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { useSyncExternalStore } from "react";
import { OWNER_EMAIL, getAuthInstance } from "./firebase";

type AuthState =
  | { status: "loading"; user: null; error: string | null }
  | { status: "signedOut"; user: null; error: string | null }
  | { status: "signedIn"; user: User; error: null };

const HINT = "signedIn";

function hadSession() {
  try {
    return localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
}

let state: AuthState = { status: "loading", user: null, error: null };
const subs = new Set<() => void>();
const set = (s: AuthState) => {
  state = s;
  subs.forEach((f) => f());
};

let started = false;
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const auth = getAuthInstance();
  getRedirectResult(auth).catch((e) => set({ status: "signedOut", user: null, error: friendly(e) }));
  onAuthStateChanged(auth, async (user) => {
    if (user && (user.email !== OWNER_EMAIL || !user.emailVerified)) {
      await fbSignOut(auth);
      set({ status: "signedOut", user: null, error: `${user.email} isn't allowed here.` });
      return;
    }
    try {
      if (user) localStorage.setItem(HINT, "1");
      else localStorage.removeItem(HINT);
    } catch {}
    set(user ? { status: "signedIn", user, error: null } : { status: "signedOut", user: null, error: state.error });
  });
}

export function useAuth() {
  start();
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** True if the last session on this device was signed in — lets us paint cached notes instantly. */
export const wasSignedIn = hadSession;

function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("popup-closed") || code.includes("cancelled-popup")) return "";
  if (code.includes("unauthorized-domain")) return "This domain isn't authorized in Firebase Auth yet.";
  if (code.includes("network")) return "You're offline. Connect once to sign in.";
  return (e as Error)?.message ?? "Sign-in failed.";
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export async function signIn() {
  const auth = getAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: OWNER_EMAIL, prompt: "select_account" });
  set({ status: "signedOut", user: null, error: null });
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
    // Local emulator only: it accepts unsigned fake Google ID tokens.
    const token = JSON.stringify({ sub: "owner", email: OWNER_EMAIL, email_verified: true, name: "Owner" });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    return;
  }
  // Home-screen apps can't reliably talk to popups; use a same-tab redirect there.
  if (isStandalone() || isMobile()) return signInWithRedirect(auth, provider);
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code.includes("popup-blocked")) return signInWithRedirect(auth, provider);
    set({ status: "signedOut", user: null, error: friendly(e) });
  }
}

export function signOut() {
  try {
    localStorage.removeItem(HINT);
  } catch {}
  return fbSignOut(getAuthInstance());
}
