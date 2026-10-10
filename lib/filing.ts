/** Shared contract for the sidebar "file with AI" action. */

export const FILING_TITLE_LIMIT = 300;
export const FILING_BODY_LIMIT = 2_000;
export const FILING_NOTE_LIMIT = 300;
export const FILING_FOLDER_LIMIT = 500;

export interface FilingNoteInput {
  id: string;
  title: string;
  body: string;
}

export interface Placement {
  id: string;
  /** An existing folder path. Null means the note stays unfiled. */
  folder: string | null;
}

export function noteLabel(note: { title: string; body: string }): string {
  const title = note.title.trim();
  if (title) return title;
  const line = note.body
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return "Untitled";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function filingPayload(folders: readonly string[], notes: readonly FilingNoteInput[]) {
  const seen = new Set<string>();
  const cleanNotes: FilingNoteInput[] = [];
  for (const n of notes) {
    const id = n.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cleanNotes.push({
      id,
      title: n.title.slice(0, FILING_TITLE_LIMIT),
      body: n.body.slice(0, FILING_BODY_LIMIT),
    });
    if (cleanNotes.length >= FILING_NOTE_LIMIT) break;
  }
  const cleanFolders: string[] = [];
  const folderSeen = new Set<string>();
  for (const f of folders) {
    const path = f.trim();
    if (!path || folderSeen.has(path)) continue;
    folderSeen.add(path);
    cleanFolders.push(path);
    if (cleanFolders.length >= FILING_FOLDER_LIMIT) break;
  }
  return { action: "file" as const, folders: cleanFolders, notes: cleanNotes };
}

/**
 * Keep only placements for the notes we asked about, and only folders that
 * already exist. Anything else stays unfiled — the model must not invent a folder.
 */
export function sanitizePlacements(folders: readonly string[], noteIds: readonly string[], raw: unknown): Placement[] {
  const allowed = new Set(folders.filter((f) => f.trim().length > 0));
  const chosen = new Map<string, string | null>();
  const items = placementItems(raw);
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; folder?: unknown };
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id || chosen.has(id)) continue;
    const folder = typeof rec.folder === "string" ? rec.folder.trim() : "";
    chosen.set(id, folder && allowed.has(folder) ? folder : null);
  }
  const seen = new Set<string>();
  const out: Placement[] = [];
  for (const id of noteIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, folder: chosen.has(id) ? chosen.get(id)! : null });
  }
  return out;
}

function placementItems(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const placements = (raw as { placements?: unknown }).placements;
  return Array.isArray(placements) ? placements : [];
}
