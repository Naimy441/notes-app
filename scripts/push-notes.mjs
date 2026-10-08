#!/usr/bin/env node
/**
 * Make Firestore match ./notes/ exactly — after editing or reorganizing it.
 *
 *   npm run notes:push -- --dry-run   show what would change, write nothing
 *   npm run notes:push                push it
 *   npm run notes:push -- --force     overwrite notes that were also changed elsewhere since the download
 *
 * Only what changed is written:
 *   - new files → new notes · edited files → updated notes
 *   - moved/renamed files (same `id` in frontmatter) → the note moves; its "modified" date only
 *     changes if its text changed, so reorganizing doesn't reshuffle your notes
 *   - deleted files → the note goes to the app's Trash (recoverable)
 *   - new/removed folders → folders created/removed
 * Notes added on another device since the download are left alone.
 * Before writing, everything in Firestore (Trash included) is backed up to .notes-backups/.
 * Afterwards ./notes/ is refreshed so it's ready for the next round.
 */
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { changeCount, connect, downloadTo, sourceName, localChanges, readManifest, REPO_DIR, stamp, textChanged } from "./lib/notes-files.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const dir = path.join(REPO_DIR, "notes");

const manifest = readManifest(dir);
if (!manifest) {
  console.error("No downloaded notes found in ./notes/. Run `npm run notes:download` first, then edit, then push.");
  process.exit(1);
}

if (manifest.source && manifest.source !== sourceName()) {
  console.error(`./notes/ was downloaded from ${manifest.source}, but this push targets ${sourceName()}. Refusing.`);
  process.exit(1);
}

const c = localChanges(dir, manifest);
if (!changeCount(c)) {
  console.log("Nothing to push — ./notes/ matches what was downloaded.");
  process.exit(0);
}

const db = connect();
const remote = new Map((await db.collection("notes").get()).docs.map((d) => [d.id, d.data()]));
const now = Date.now();
const writes = []; // [id, data]
const conflicts = [];
const lines = { new: [], edited: [], moved: [], trashed: [] };

for (const n of c.edited) {
  const r = remote.get(n.id);
  const m = manifest.notes[n.id];
  if (!r || r.deleted) {
    conflicts.push(`${n.path}: deleted elsewhere since the download`);
    if (!force) continue;
  } else if (r.updatedAt > m.updatedAt) {
    conflicts.push(`${n.path}: also edited elsewhere since the download`);
    if (!force) continue;
  }
  const base = r ?? {};
  const text = textChanged(n, base);
  const { id, path: rel, ...fields } = n;
  writes.push([id, { ...fields, path: rel, deleted: false, updatedAt: text ? now : Math.max((base.updatedAt ?? 0) + 1, 1) }]);
  if ((base.folder ?? "") !== n.folder || (base.title ?? "") !== n.title) lines.moved.push(`${base.folder || "(no folder)"}/${base.title || "untitled"} → ${rel}`);
  const bodyChanged = textChanged({ body: n.body }, { body: base.body });
  const flagsChanged = !!base.pinned !== n.pinned || !!base.archived !== n.archived;
  if (bodyChanged || flagsChanged) lines.edited.push(`${rel}${flagsChanged ? ` (${n.pinned ? "pinned" : "unpinned"}${n.archived ? ", archived" : ""})` : ""}`);
}

for (const n of c.created) {
  const fields = { ...n, deleted: false };
  delete fields.id;
  writes.push([db.collection("notes").doc().id, fields]);
  const rel = n.path;
  lines.new.push(rel);
}

for (const id of c.removed) {
  const r = remote.get(id);
  if (!r || r.deleted) continue; // already gone
  if (r.updatedAt > manifest.notes[id].updatedAt) {
    conflicts.push(`${r.folder ? r.folder + "/" : ""}${r.title || "untitled"}: deleted here but edited elsewhere since the download`);
    if (!force) continue;
  }
  writes.push([id, { deleted: true, updatedAt: Math.max(now, (r.updatedAt ?? 0) + 1) }]);
  lines.trashed.push(`${r.folder ? r.folder + "/" : ""}${r.title || "untitled"}`);
}

const known = new Set(Object.keys(manifest.notes));
const addedElsewhere = [...remote].filter(([id, r]) => !known.has(id) && !r.deleted).length;

// ─── report ──────────────────────────────────────────────────────────────────
const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length}):`);
  for (const l of list.slice(0, 40)) console.log(`  ${l}`);
  if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
};
show("New notes", lines.new);
show("Moved / renamed", lines.moved);
show("Edited", lines.edited);
show("To Trash", lines.trashed);
show("New folders", c.newFolders);
show("Removed folders", c.goneFolders);
if (addedElsewhere) console.log(`\n${addedElsewhere} notes were added on another device since the download; they're kept as-is.`);
if (conflicts.length) {
  show(force ? "Conflicts (overwriting because of --force)" : "Conflicts — skipped", conflicts);
  if (!force) console.log("\nRe-run with --force to overwrite those, or `npm run notes:download -- --force` to start over from the latest.");
}

if (dryRun) {
  console.log("\nDry run — nothing was written.");
  process.exit(0);
}
if (conflicts.length && !force) process.exit(1);
if (!writes.length && !c.newFolders.length && !c.goneFolders.length) {
  console.log("\nNothing to write.");
  process.exit(0);
}

// ─── write ───────────────────────────────────────────────────────────────────
const backupDir = path.join(REPO_DIR, ".notes-backups", stamp());
await downloadTo(db, backupDir, { includeTrash: true });
console.log(`\nBacked up Firestore to ${path.relative(REPO_DIR, backupDir)}/`);

const writer = db.bulkWriter();
writer.onWriteError((err) => err.failedAttempts < 5);
for (const [id, data] of writes) {
  writer.set(db.collection("notes").doc(id), { ...data, syncedAt: FieldValue.serverTimestamp() }, { merge: true });
}
const folderDoc = (p, deleted) =>
  writer.set(db.collection("folders").doc(encodeURIComponent(p)), { path: p, deleted, updatedAt: now, syncedAt: FieldValue.serverTimestamp() });
c.newFolders.forEach((p) => folderDoc(p, false));
c.goneFolders.forEach((p) => folderDoc(p, true));
await writer.close();
console.log(`Pushed ${writes.length} note changes and ${c.newFolders.length + c.goneFolders.length} folder changes.`);

const fresh = await downloadTo(db, dir);
console.log(`Refreshed ./notes/ (${fresh.written} notes, ${fresh.folders} folders).`);
process.exit(0);
