import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import {
  CACHE_SIZE_UNLIMITED,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

export const OWNER_EMAIL = "abdullah.naim.441@gmail.com";

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";

function authDomain() {
  // On a real deployment, auth runs through this app's own domain (proxied to
  // Firebase via the /__/auth rewrite in next.config.ts). That keeps the
  // redirect flow first-party, which iOS home-screen apps require.
  if (typeof window !== "undefined") {
    const host = window.location.host;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host;
  }
  return "note-d7ce7.firebaseapp.com";
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function getApp() {
  if (!app) {
    app =
      getApps()[0] ??
      initializeApp({
        apiKey: "AIzaSyAQmcPniVOBtXDi00Q78xmV4t4q6YV2QiE",
        authDomain: authDomain(),
        projectId: "note-d7ce7",
        storageBucket: "note-d7ce7.firebasestorage.app",
        messagingSenderId: "712151380618",
        appId: "1:712151380618:web:93cb99f9e38223a7833373",
      });
  }
  return app;
}

export function getAuthInstance() {
  if (!auth) {
    auth = initializeAuth(getApp(), {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    if (useEmulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}

export function getDb() {
  if (!db) {
    db = initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        // Never evict: the whole vault lives offline on the device.
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
    });
    if (useEmulators) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return db;
}
