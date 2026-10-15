/**
 * Find & replace matching, shared by the in-note find bar and "Replace in
 * notes". Plain text by default (case-insensitive), with whole-word and
 * regular-expression options. Positions are string offsets into the text.
 */

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Replacing "Kiwi" or "KIWI" with "mango" gives "Mango" / "MANGO". */
  keepCase?: boolean;
}

export interface Match {
  from: number;
  to: number;
}

export const DEFAULT_FIND: FindOptions = { query: "", caseSensitive: false, wholeWord: false, regex: false, keepCase: false };

/** Stop collecting after this many: enough to count, cheap enough to highlight. */
export const MATCH_LIMIT = 5000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Letters and digits in any script (so "whole word" works for Arabic too).
const WORD_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}_])";
const WORD_AFTER = "(?![\\p{L}\\p{M}\\p{N}_])";

/** A global regex for the options, or why there isn't one. */
export function compileFind(o: FindOptions): { re: RegExp | null; error?: string } {
  if (!o.query) return { re: null };
  let src = o.regex ? o.query : escapeRe(o.query);
  if (o.wholeWord) src = `${WORD_BEFORE}(?:${src})${WORD_AFTER}`;
  try {
    return { re: new RegExp(src, o.caseSensitive ? "gu" : "giu") };
  } catch {
    return { re: null, error: "Invalid pattern" };
  }
}

/** Every non-empty match of `re` in `text`, up to `limit`. */
export function findAll(text: string, re: RegExp, limit = MATCH_LIMIT): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0].length === 0) {
      // Patterns like `a*` or `^` also match nothing; skip those spots.
      re.lastIndex = m.index + (text.codePointAt(m.index)! > 0xffff ? 2 : 1);
      continue;
    }
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  re.lastIndex = 0;
  return out;
}

/** The regex match that starts exactly at `from`, with its groups. */
export function matchAt(text: string, re: RegExp, from: number): RegExpExecArray | null {
  re.lastIndex = from;
  const m = re.exec(text);
  re.lastIndex = 0;
  return m && m.index === from && m[0].length > 0 ? m : null;
}

/**
 * The text that replaces `m`. Plain-text searches insert the replacement as
 * typed. Regex searches understand `$&`, `$1`…`$99`, `$<name>` and `$$`.
 */
export function expandReplacement(replacement: string, m: RegExpExecArray, regex: boolean): string {
  if (!regex) return replacement;
  return replacement.replace(/\$(\$|&|<([^>]*)>|(\d{1,2}))/g, (whole, tok: string, name?: string, num?: string) => {
    if (tok === "$") return "$";
    if (tok === "&") return m[0];
    if (name !== undefined) return m.groups?.[name] ?? "";
    if (num !== undefined) {
      // "$12" means group 12 only if there is one; otherwise group 1 then "2".
      const n = Number(num);
      if (n > 0 && n < m.length) return m[n] ?? "";
      if (num.length === 2) {
        const one = Number(num[0]);
        if (one > 0 && one < m.length) return (m[one] ?? "") + num[1];
      }
    }
    return whole;
  });
}

/**
 * Give `replacement` the capitalization of the text it replaces: ALL CAPS, or a
 * capital first letter. Anything else (lowercase, mixed) leaves it as typed.
 */
export function matchCase(original: string, replacement: string): string {
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (!letters || letters.toLowerCase() === letters.toUpperCase()) return replacement; // no cased letters (e.g. Arabic)
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  const first = letters[0];
  const rest = letters.slice(1);
  if (first === first.toUpperCase() && rest === rest.toLowerCase()) {
    const i = replacement.search(/\p{L}/u);
    return i < 0 ? replacement : replacement.slice(0, i) + replacement[i].toUpperCase() + replacement.slice(i + 1);
  }
  return replacement;
}

/** The text that replaces `m`, with every option applied. */
export function replacementFor(replacement: string, m: RegExpExecArray, o: Pick<FindOptions, "regex" | "keepCase">): string {
  const text = expandReplacement(replacement, m, o.regex);
  return o.keepCase ? matchCase(m[0], text) : text;
}

/** Replace every match in `text`. */
export function replaceAllIn(
  text: string,
  re: RegExp,
  replacement: string,
  o: Pick<FindOptions, "regex" | "keepCase">,
): { text: string; count: number } {
  const matches = findAll(text, re, Number.MAX_SAFE_INTEGER);
  if (!matches.length) return { text, count: 0 };
  let out = "";
  let last = 0;
  for (const { from, to } of matches) {
    const m = matchAt(text, re, from);
    out += text.slice(last, from) + (m ? replacementFor(replacement, m, o) : text.slice(from, to));
    last = to;
  }
  return { text: out + text.slice(last), count: matches.length };
}

/** A one-line excerpt around a match, for previews. */
export function excerpt(text: string, m: Match, radius = 36): { before: string; hit: string; after: string } {
  const lineStart = text.lastIndexOf("\n", m.from - 1) + 1;
  const nl = text.indexOf("\n", m.to);
  const lineEnd = nl === -1 ? text.length : nl;
  const from = Math.max(lineStart, m.from - radius);
  const to = Math.min(lineEnd, m.to + radius);
  return {
    before: (from > lineStart ? "…" : "") + text.slice(from, m.from).trimStart(),
    hit: text.slice(m.from, m.to),
    after: text.slice(m.to, to).trimEnd() + (to < lineEnd ? "…" : ""),
  };
}
