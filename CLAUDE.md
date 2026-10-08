@AGENTS.md

## Editing the user's notes

The notes live in Firestore (project `note-d7ce7`). To read, edit or reorganize them, work on local Markdown files:

1. `npm run notes:download` — pulls every note into `./notes/` (gitignored), one `.md` file per note, folders as directories.
2. Edit `./notes/` with normal file operations: rewrite text, rename or move files, create or delete folders and notes.
   - Keep each file's frontmatter `id` — that's how a moved/renamed file stays the same note. A file without an `id` becomes a new note.
   - Frontmatter `pinned: true` / `archived: true` control pinning and archiving. `created` / `modified` are the note's dates; leave them unless asked.
   - The file name is the note's title (frontmatter `title` overrides it when the title can't be a file name). Untitled notes are named like `Oct 8, 2026, 1.22 AM.md`.
   - Deleting a file sends the note to the app's Trash (recoverable there).
3. `npm run notes:push -- --dry-run` — review the summary of what will change, and show it to the user.
4. `npm run notes:push` — writes only the changes, after backing up all of Firestore to `.notes-backups/<timestamp>/`. Moves don't change a note's "modified" date; text edits do.

If push reports conflicts (a note was also changed on another device since the download), don't use `--force` without asking the user; prefer re-downloading and redoing the edit on the latest version. `notes:download` refuses to overwrite unpushed local edits unless given `--force` — likewise ask first.

These scripts need the service-account key (`*-firebase-adminsdk-*.json` in the repo root, gitignored). Never print or commit it.
