"use client";

import dynamic from "next/dynamic";
import { Splash } from "./Splash";

// Everything is client-side (Firebase, IndexedDB); the server only ships the static shell.
const App = dynamic(() => import("./App"), { ssr: false, loading: () => <Splash /> });

export default function ClientApp() {
  return <App />;
}
