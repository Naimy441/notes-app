# Notes

A Google Keep–style notes app for one person, stored in Firestore and synced across devices.

- **Mobile-first**: two-column masonry on phones, up to six columns with a sidebar on desktop. Installs to the iPhone home screen.
- **Offline-first**: notes are read from Firestore's on-device cache before the network responds. Edits made offline are queued and sync when you're back online. A service worker caches the app itself, so it opens with no connection at all.
- **Folders**: folders show as cards with page previews, nested to any depth. You can create, rename, delete and move between them.
- **Search** covers titles, bodies and folder names, and highlights the matches.
- **Pinned** notes come first. You choose whether everything else is ordered by date modified or date created.
- Markdown with checklists you can tap, `[[wikilinks]]`, Archive, Trash with undo, and light, dark or automatic theme.
- Only `abdullah.naim.441@gmail.com` can sign in. Firestore security rules enforce this on the server, not just in the UI.

## Setup

### 1. Firebase (already done)

The Firebase project `note-d7ce7` has a web app, a Firestore database (`nam5`) and the rules in `firestore.rules` deployed. If you change the rules, redeploy them:

```bash
firebase deploy --only firestore:rules
```

### 2. Deploy to Vercel

```bash
vercel --prod
```

No environment variables are needed; the Firebase web config is public by design. After the first deploy, take your domain (for example `my-notes.vercel.app`) and:

1. Firebase console → Authentication → **Settings → Authorized domains** → add `my-notes.vercel.app`.
2. Google Cloud console → APIs & Services → **Credentials** → the OAuth client named *Web client (auto created by Google Service)* → **Authorized redirect URIs** → add `https://my-notes.vercel.app/__/auth/handler`.

Google sign-in goes through your own domain (`/__/auth/*` is proxied to Firebase in `next.config.ts`). iOS home-screen apps need this: Safari blocks the cross-site storage that the default Firebase sign-in flow relies on.

### 3. Add to iPhone home screen

Open the site in Safari → Share → **Add to Home Screen**.

## Editing notes in bulk (e.g. with Claude)

```bash
npm run notes:download            # every note → ./notes/ as Markdown files in folders (gitignored)
# …edit, rename, move, delete files in ./notes/ (by hand or ask Claude to)…
npm run notes:push -- --dry-run   # preview what will change
npm run notes:push                # apply it (backs up Firestore to .notes-backups/ first)
```

- Each file's frontmatter keeps its `id`, so moving or renaming a file moves the note instead of duplicating it. Files without an `id` become new notes.
- Deleted files go to the app's Trash. Moving notes doesn't change their "modified" date; editing text does.
- Push only writes what changed, and won't overwrite a note that was also edited on another device since the download (`--force` overrides).
- Needs a service-account key: Firebase console → Project settings → Service accounts → Generate new private key, saved in the repo root (`*-firebase-adminsdk-*.json` is gitignored and vercelignored).

## Development

```bash
npm run dev             # localhost:3000 against your real Firebase (sign in with Google)
npm run emulators       # optional: local Firestore + Auth emulators (needs Java)
npm run dev:emulators   # localhost:3000 against the emulators instead
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
| `public/sw.js` | Offline app shell |
| `scripts/download-notes.mjs`, `scripts/push-notes.mjs` | Bulk edit workflow (shared code in `scripts/lib/notes-files.mjs`) |
| `scripts/build-icon-svg.mjs` | Regenerates `app/icon.svg` from `lib/icon-art.tsx` |
