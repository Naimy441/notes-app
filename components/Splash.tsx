import { GridSkeleton } from "./NoteGrid";

/** Static shell painted before JS loads: header + skeleton cards. */
export function Splash() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="searchbar" />
      </header>
      <main className="content" style={{ paddingTop: 18 }}>
        <GridSkeleton />
      </main>
    </div>
  );
}
