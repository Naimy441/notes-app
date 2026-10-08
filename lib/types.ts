export interface Note {
  id: string;
  title: string;
  body: string;
  /** Vault-relative folder path, e.g. "Ideas/AI". "" is the vault root. */
  folder: string;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  /** ms since epoch */
  createdAt: number;
  /** ms since epoch; also the last-writer-wins version */
  updatedAt: number;
  /** Vault-relative file path, owned by the Obsidian sync script. */
  path?: string | null;
  /** Extra YAML frontmatter preserved from Obsidian (tags stripped). */
  fm?: string | null;
}

export interface FolderDoc {
  id: string;
  path: string;
  deleted: boolean;
  updatedAt: number;
}

export interface FolderNode {
  path: string;
  name: string;
  parent: string;
  children: string[];
  /** Non-archived, non-deleted notes directly inside this folder. */
  notes: Note[];
  /** Same, recursively including subfolders. */
  total: number;
}

export type SortKey = "updatedAt" | "createdAt";
export type ThemePref = "system" | "light" | "dark";
