"use client";

import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { useEffect, useState } from "react";
import { signIn, signOut, useAuth, wasSignedIn } from "@/lib/auth";
import { getDb } from "@/lib/firebase";
import { applyTheme, usePrefs } from "@/lib/prefs";
import { loadCache, startSync, stopSync } from "@/lib/store";
import { GoogleLogo, NotesIcon } from "./icons";
import { Shell } from "./Shell";
import { Splash } from "./Splash";

export default function App() {
  const auth = useAuth();
  const prefs = usePrefs();
  const [hinted] = useState(wasSignedIn);

  // Paint from the on-device cache immediately — no waiting on auth or network.
  useEffect(() => {
    if (hinted) loadCache();
  }, [hinted]);

  useEffect(() => {
    if (auth.status === "signedIn") startSync();
  }, [auth.status]);

  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [prefs.theme]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
  }, []);

  const handleSignOut = async () => {
    stopSync();
    await signOut();
    try {
      const db = getDb();
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch {}
    location.replace("/");
  };

  if (auth.status === "signedIn") return <Shell user={auth.user} onSignOut={handleSignOut} />;
  if (auth.status === "loading") return hinted ? <Shell user={null} onSignOut={handleSignOut} /> : <Splash />;
  return <SignIn error={auth.error} />;
}

function SignIn({ error }: { error: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-logo">
          <NotesIcon size={42} />
        </div>
        <h1>Notes</h1>
        <p>Your notes, everywhere — synced with Obsidian.</p>
        <button
          className="gbtn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signIn();
            } finally {
              setBusy(false);
            }
          }}
        >
          <GoogleLogo />
          {busy ? "Signing in…" : "Continue with Google"}
        </button>
        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}
