// Shared helpers for the download / replace scripts: Firestore admin access and
// the Markdown file format notes are exported to and imported from.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import YAML from "yaml";

export const PROJECT_ID = "note-d7ce7";
export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ─── Firestore ───────────────────────────────────────────────────────────────

/**
 * Admin access via a service-account key: $NOTES_KEY, or a downloaded
 * `*-firebase-adminsdk-*.json` in the repo root (gitignored and vercelignored).
 */
export function connect() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: PROJECT_ID });
    return getFirestore();
  }
  const key =
    process.env.NOTES_KEY ??
    fs
      .readdirSync(REPO_DIR)
      .filter((f) => /-firebase-adminsdk-.*\.json$/.test(f))
      .map((f) => path.join(REPO_DIR, f))[0];
  if (!key || !fs.existsSync(key)) {
    console.error(
      "No service-account key found.\n" +
        "Firebase console → Project settings → Service accounts → Generate new private key,\n" +
        `then put the downloaded JSON file in ${REPO_DIR} (it's gitignored), or set NOTES_KEY=/path/to/key.json`,
    );
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(key, "utf8"))), projectId: PROJECT_ID });
  return getFirestore();
}

// ─── file format ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Untitled notes are named after their creation time, like Google Keep's export. */
const UNTITLED_RE = new RegExp(`^(${MONTHS.join("|")}) \\d{1,2}, \\d{4}, \\d{1,2}\\.\\d{2} [AP]M( \\d+)?$`);
/** Frontmatter keys this app owns; everything else is preserved as-is in `fm`. */
const OWN_KEYS = ["id", "title", "pinned", "archived", "created", "modified", "tags", "tag"];

function dateName(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}.${m} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

const safeName = (s) =>
  s
    .replace(/[/\\:]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();

/** File name (without .md) for a note, and whether the title must also go in frontmatter. */
export function fileBaseName(note) {
  const title = (note.title ?? "").trim();
  if (!title) return { base: dateName(note.createdAt || Date.now()), titleInFm: false };
  const base = safeName(title) || "Untitled";
  return { base, titleInFm: base !== title };
}

export function serializeNote(note, { titleInFm }) {
  let extra = {};
  if (note.fm) {
    try {
      extra = YAML.parse(note.fm) ?? {};
    } catch {}
  }
  const head = {};
  if (note.id) head.id = note.id;
  if (titleInFm) head.title = note.title;
  if (note.pinned) head.pinned = true;
  if (note.archived) head.archived = true;
  if (note.createdAt) head.created = new Date(note.createdAt).toISOString();
  if (note.updatedAt) head.modified = new Date(note.updatedAt).toISOString();
  const data = { ...head, ...extra };
  return `---\n${YAML.stringify(data)}---\n\n${note.body ?? ""}`;
}

/**
 * Drop the "## Annotations" link-preview sections the Google Keep importer appended,
 * from that heading up to the next level 1–2 heading or the end of the note.
 */
export function stripAnnotations(body) {
  if (!body.includes("## Annotations")) return body;
  const out = [];
  let skipping = false;
  for (const line of body.split("\n")) {
    if (/^##\s+Annotations\s*$/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^#{1,2}\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}

const toMs = (v) => {
  if (v instanceof Date) return v.getTime();
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Parse one Markdown file into note fields. `stat` supplies fallback dates. */
export function parseNoteFile(rel, content, stat) {
  let data = {};
  let body = content;
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (m) {
    try {
      const parsed = YAML.parse(m[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed;
        body = content.slice(m[0].length);
      }
    } catch {}
  }
  const rawTags = data.tags ?? data.tag ?? [];
  const tags = (Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[,\s]+/)).map((t) => String(t).replace(/^#/, ""));
  const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !OWN_KEYS.includes(k)));
  const name = path.posix.basename(rel, ".md");
  const dir = path.posix.dirname(rel);
  const birth = stat.birthtimeMs > 0 ? Math.min(stat.birthtimeMs, stat.mtimeMs) : stat.mtimeMs;
  return {
    id: typeof data.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.id) ? data.id : null,
    title: typeof data.title === "string" ? data.title : UNTITLED_RE.test(name) ? "" : name,
    body: stripAnnotations(body.replace(/^(\r?\n)+/, "")),
    folder: dir === "." ? "" : dir,
    pinned: data.pinned === true || tags.includes("Keep/Pinned"),
    archived: data.archived === true || tags.includes("Keep/Archived"),
    deleted: false,
    createdAt: toMs(data.created) ?? Math.round(birth),
    updatedAt: toMs(data.modified) ?? Math.round(stat.mtimeMs),
    path: rel,
    fm: Object.keys(extra).length ? YAML.stringify(extra) : null,
  };
}

/** Every .md file and folder under `root`, skipping hidden entries (.obsidian, .trash, …). */
export function scanFolder(root) {
  const files = [];
  const dirs = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(r);
        walk(a, r);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        files.push({ rel: r, abs: a });
      }
    }
  };
  walk(root, "");
  return { files, dirs };
}

// ─── download / push support ────────────────────────────────────────────────

/** The fields that make up a note's content; a change to any of them is a change to push. */
const normBody = (b) => (b ?? "").replace(/^(\r?\n)+/, "").replace(/\s+$/, "");
const normFm = (fm) => {
  if (!fm) return "";
  try {
    const v = YAML.parse(String(fm));
    return v && typeof v === "object" && Object.keys(v).length ? JSON.stringify(v) : "";
  } catch {
    return String(fm).trim();
  }
};

export function contentHash(n) {
  const key = JSON.stringify([n.title ?? "", normBody(n.body), n.folder ?? "", !!n.pinned, !!n.archived, normFm(n.fm), n.createdAt ?? 0]);
  return createHash("sha1").update(key).digest("hex");
}

/** Text changed (as opposed to only being moved, pinned or archived) — bumps "modified". */
export const textChanged = (a, b) => (a.title ?? "") !== (b.title ?? "") || normBody(a.body) !== normBody(b.body);

/** What changed in the working folder since it was downloaded. */
export function localChanges(dir, manifest) {
  const { notes, folders } = readFolder(dir);
  const seen = new Set();
  const created = [];
  const edited = [];
  for (const n of notes) {
    const m = n.id && !seen.has(n.id) ? manifest.notes[n.id] : null;
    if (!m) {
      created.push({ ...n, id: null }); // no id, an unknown id, or a duplicated file: a new note
      continue;
    }
    seen.add(n.id);
    if (contentHash(n) !== m.hash) edited.push(n);
  }
  const removed = Object.keys(manifest.notes).filter((id) => !seen.has(id));
  const known = new Set(manifest.folders);
  return {
    notes,
    folders,
    created,
    edited,
    removed,
    newFolders: [...folders].filter((f) => !known.has(f)),
    goneFolders: manifest.folders.filter((f) => !folders.has(f)),
  };
}

export const changeCount = (c) => c.created.length + c.edited.length + c.removed.length + c.newFolders.length + c.goneFolders.length;

export const MANIFEST = ".manifest.json";

/** Which database a download came from, so a push can't cross from the emulator to the real one. */
export const sourceName = () => (process.env.FIRESTORE_EMULATOR_HOST ? `emulator:${process.env.FIRESTORE_EMULATOR_HOST}` : PROJECT_ID);

/**
 * Write every live note (not in Trash) to `dir` as Markdown files in their folders,
 * plus a manifest recording each note's version, so a later push can tell what
 * changed locally and what changed elsewhere (e.g. on your phone) in the meantime.
 * `dir` is emptied first.
 */
export async function downloadTo(db, dir, { includeTrash = false } = {}) {
  const [noteSnap, folderSnap] = await Promise.all([db.collection("notes").get(), db.collection("folders").get()]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { source: sourceName(), downloadedAt: Date.now(), notes: {}, folders: [] };
  for (const f of folderSnap.docs) {
    const p = f.data().path;
    if (!p || f.data().deleted) continue;
    fs.mkdirSync(path.join(dir, ...p.split("/")), { recursive: true });
    manifest.folders.push(p);
  }
  const taken = new Set();
  let written = 0;
  for (const doc of noteSnap.docs) {
    const n = { ...doc.data(), id: doc.id };
    if (n.deleted && !includeTrash) continue;
    const { base, titleInFm } = fileBaseName(n);
    const folder = n.deleted ? path.posix.join(".trash", n.folder ?? "") : (n.folder ?? "");
    let rel = path.posix.join(folder, `${base}.md`);
    for (let i = 2; taken.has(rel.toLowerCase()); i++) rel = path.posix.join(folder, `${base} ${i}.md`);
    taken.add(rel.toLowerCase());
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // A file name that differs from the title (or got a collision suffix) needs the title in frontmatter.
    const needsTitle = titleInFm || (!!n.title && path.posix.basename(rel, ".md") !== base);
    fs.writeFileSync(abs, serializeNote(n, { titleInFm: needsTitle }));
    if (n.updatedAt) fs.utimesSync(abs, new Date(n.updatedAt), new Date(n.updatedAt));
    if (!n.deleted) manifest.notes[doc.id] = { updatedAt: n.updatedAt ?? 0, hash: contentHash(n) };
    written++;
  }
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest));
  return { written, folders: manifest.folders.length };
}

export function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
  } catch {
    return null;
  }
}

/** Parse every note file in `dir`. */
export function readFolder(dir) {
  const { files, dirs } = scanFolder(dir);
  const notes = files.map(({ rel, abs }) => parseNoteFile(rel, fs.readFileSync(abs, "utf8"), fs.statSync(abs)));
  const folders = new Set(dirs);
  for (const n of notes) for (let p = n.folder; p; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") folders.add(p);
  return { notes, folders };
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
