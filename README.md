# Notes

A Google Keep–style notes app for one person, synced two ways with an Obsidian vault through Firestore.

- **Mobile-first**: two-column masonry on phones, up to six columns with a sidebar on desktop. Installs to the iPhone home screen.
- **Offline-first**: notes are read from Firestore's on-device cache before the network responds. Edits made offline are queued and sync when you're back online. A service worker caches the app itself, so it opens with no connection at all.
- **Folders**: vault folders show as cards with page previews, nested to any depth. You can create, rename, delete and move between them.
- **Search** covers titles, bodies and folder names, and highlights the matches.
- **Pinned** notes come first. You choose whether everything else is ordered by date modified or date created.
- Markdown with checklists you can tap, `[[wikilinks]]`, Archive, Trash with undo, and light, dark or automatic theme.
- Only `abdullah.naim.441@gmail.com` can sign in. Firestore security rules enforce this on the server, not just in the UI.

## How sync works

```
Obsidian vault  ⇄  scripts/obsidian-sync.mjs (your Mac)  ⇄  Firestore  ⇄  web app (phone / desktop)
```

Each note is one Firestore document. The sync script keeps a small state file (`~/.config/notes-sync/state.json`) that records which file each document maps to and the file's hash at the last sync. That lets it tell edits, renames, moves and deletions apart on each side.

- If the same note changed on both sides, the newer edit wins. The older version is kept as `Note (conflict YYYY-MM-DD).md`.
- Notes deleted in the app go to the vault's `.trash/` folder. The script never deletes a file outright.
- Keep-import tags are dropped. `Keep/Pinned` becomes `pinned: true` and `Keep/Archived` becomes `archived: true`. Any other frontmatter (for example `aliases`) is preserved.
- Keep's untitled notes, whose filenames look like `Oct 8, 2026, 1.22 AM.md`, show without a title, the way they did in Keep.

## Setup

### 1. Firebase (already done)

The Firebase project `note-d7ce7` has a web app, a Firestore database (`nam5`) and the rules in `firestore.rules` deployed. If you change the rules, redeploy them:

```bash
firebase deploy --only firestore:rules
```

### 2. Import your vault and keep it syncing

1. Create a service-account key: Firebase console → ⚙ Project settings → **Service accounts** → **Generate new private key**.
2. Move the key to where the script expects it:
   ```bash
   mkdir -p ~/.config/notes-sync && mv ~/Downloads/note-d7ce7-*.json ~/.config/notes-sync/service-account.json
   ```
3. Run the first sync, which uploads all your notes. It takes a few seconds.
   ```bash
   npm run sync
   ```
4. Keep syncing in the background, starting at login:
   ```bash
   npm run sync:install
   ```
   Logs are written to `~/.config/notes-sync/sync.log`. If they show `EPERM`, give `node` access to your Documents folder in System Settings → Privacy & Security → Files and Folders (or Full Disk Access). To stop background sync, run `npm run sync:uninstall`.

The vault path defaults to `~/Documents/Notes`. To use a different vault, set `NOTES_VAULT=/path/to/vault`.

### 3. Deploy to Vercel

```bash
vercel --prod
```

No environment variables are needed; the Firebase web config is public by design. After the first deploy, take your domain (for example `my-notes.vercel.app`) and:

1. Firebase console → Authentication → **Settings → Authorized domains** → add `my-notes.vercel.app`.
2. Google Cloud console → APIs & Services → **Credentials** → the OAuth client named *Web client (auto created by Google Service)* → **Authorized redirect URIs** → add `https://my-notes.vercel.app/__/auth/handler`.

Google sign-in goes through your own domain (`/__/auth/*` is proxied to Firebase in `next.config.ts`). iOS home-screen apps need this: Safari blocks the cross-site storage that the default Firebase sign-in flow relies on.

### 4. Add to iPhone home screen

Open the site in Safari → Share → **Add to Home Screen**.

## Development

```bash
npm run dev             # localhost:3000 against your real Firebase (sign in with Google)
npm run emulators       # optional: local Firestore + Auth emulators (needs Java)
npm run dev:emulators   # localhost:3000 against the emulators instead
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NOTES_VAULT=/tmp/vault-copy npm run sync
```

With `dev:emulators`, the sign-in button signs in as the owner directly, without a Google account picker.

Keyboard shortcuts (desktop): `/` focuses search, `c` creates a note, `Esc` closes a note, `⌘↵` closes the editor, `Ctrl/⌘ K` adds a link (select text first to link it).

## Code map

| Path | What |
| --- | --- |
| `lib/store.ts` | Notes and folders store: reads the on-device cache first, then listens only for documents changed since the last sync (`syncedAt`), resolves conflicts by last writer, debounces offline-safe writes |
| `lib/derive.ts` | Folder tree, search, sorting, dates |
| `lib/markdown.ts` | markdown-it with task lists, wikilinks, and source-line mapping (tap a line to edit it) |
| `components/Shell.tsx` | Views, header, drawer, card-to-editor view transitions |
| `components/Editor.tsx` | Preview/edit note sheet, list continuation, keyboard-aware sizing on iOS |
| `scripts/obsidian-sync.mjs` | Two-way vault sync (`--watch`, `--install`) |
| `public/sw.js` | Offline app shell |
