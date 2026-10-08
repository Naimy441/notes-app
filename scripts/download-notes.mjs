#!/usr/bin/env node
/**
 * Download every note into ./notes/ (gitignored) as Markdown files in their folders,
 * ready to be read, edited or reorganized — then sent back with `npm run notes:push`.
 *
 *   npm run notes:download             refresh ./notes/ from Firestore
 *   npm run notes:download -- --force  …even if ./notes/ has edits that weren't pushed
 *
 * Each file's frontmatter holds its `id` (keep it — that's how a moved or renamed
 * file stays the same note), plus pinned / archived / created / modified.
 */
import path from "node:path";
import { changeCount, connect, downloadTo, localChanges, readManifest, REPO_DIR } from "./lib/notes-files.mjs";

const force = process.argv.includes("--force");
const dir = path.join(REPO_DIR, "notes");

const manifest = readManifest(dir);
if (manifest && !force) {
  const c = localChanges(dir, manifest);
  if (changeCount(c)) {
    console.error(
      `notes/ has changes that haven't been pushed (${c.created.length} new, ${c.edited.length} edited, ` +
        `${c.removed.length} deleted notes; ${c.newFolders.length} new, ${c.goneFolders.length} removed folders).\n` +
        "Push them with `npm run notes:push`, or discard them with `npm run notes:download -- --force`.",
    );
    process.exit(1);
  }
}

const db = connect();
const { written, folders } = await downloadTo(db, dir);
console.log(`Downloaded ${written} notes and ${folders} folders to ${dir}`);
process.exit(0);
