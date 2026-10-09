import MarkdownIt, { type StateCore, type StateInline } from "markdown-it";
import { ARABIC_RUN } from "./bidi";

// html: false escapes any raw HTML in notes, so rendered output is safe to inject.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Blocks whose text direction should follow their content (Arabic → RTL), like Keep did.
const DIR_AUTO = new Set([
  "paragraph_open",
  "heading_open",
  "bullet_list_open",
  "ordered_list_open",
  "list_item_open",
  "blockquote_open",
  "th_open",
  "td_open",
]);

// Tag every block with its source line so a tap in preview can place the caret there,
// and let each block pick its own text direction.
md.core.ruler.push("source_lines", (state: StateCore) => {
  for (const t of state.tokens) {
    if (t.map && t.nesting === 1) {
      t.attrSet("data-line", String(t.map[0]));
      t.attrSet("data-line-end", String(t.map[1] - 1));
    }
    if (DIR_AUTO.has(t.type)) t.attrSet("dir", "auto");
  }
});

// Keep notes put several lines in one paragraph; give each line its own direction so an
// English line followed by an Arabic one aligns each correctly. Only splits at line breaks
// that aren't inside formatting (e.g. **bold across\nlines** stays a normal <br>).
md.core.ruler.push("bidi_lines", (state: StateCore) => {
  for (const t of state.tokens) {
    const kids = t.children;
    if (t.type !== "inline" || !kids?.some((k) => k.type === "softbreak")) continue;
    // Task items are [checkbox, <span task-text>, …text…, </span>]; only split the text.
    const isTask = kids[0]?.type === "html_inline" && kids[0].content.startsWith('<input type="checkbox"');
    const from = isTask ? 2 : 0;
    const to = isTask ? kids.length - 1 : kids.length;
    let depth = 0;
    const splits = new Set<number>();
    for (let i = from; i < to; i++) {
      if (kids[i].type === "softbreak" && depth === 0) splits.add(i);
      depth += kids[i].nesting;
    }
    if (!splits.size) continue;
    const open = () => Object.assign(new state.Token("html_inline", "", 0), { content: '<span class="ln" dir="auto">' });
    const close = () => Object.assign(new state.Token("html_inline", "", 0), { content: "</span>" });
    const out = [...kids.slice(0, from), open()];
    for (let i = from; i < to; i++) {
      if (splits.has(i)) out.push(close(), open());
      else out.push(kids[i]);
    }
    out.push(close(), ...kids.slice(to));
    t.children = out;
  }
});

// Arabic script renders a little larger than the surrounding Latin text.
md.core.ruler.push("arabic_size", (state: StateCore) => {
  for (const tok of state.tokens) {
    const kids = tok.children;
    if (tok.type !== "inline" || !kids) continue;
    let changed = false;
    const out = [];
    for (const child of kids) {
      ARABIC_RUN.lastIndex = 0;
      if (child.type !== "text" || !ARABIC_RUN.test(child.content)) {
        out.push(child);
        continue;
      }
      changed = true;
      ARABIC_RUN.lastIndex = 0;
      let last = 0;
      for (const m of child.content.matchAll(ARABIC_RUN)) {
        const at = m.index ?? 0;
        if (at > last) {
          const plain = new state.Token("text", "", 0);
          plain.content = child.content.slice(last, at);
          out.push(plain);
        }
        const open = new state.Token("html_inline", "", 0);
        open.content = '<span class="ar">';
        const inner = new state.Token("text", "", 0);
        inner.content = m[0];
        const close = new state.Token("html_inline", "", 0);
        close.content = "</span>";
        out.push(open, inner, close);
        last = at + m[0].length;
      }
      if (last < child.content.length) {
        const plain = new state.Token("text", "", 0);
        plain.content = child.content.slice(last);
        out.push(plain);
      }
    }
    if (changed) tok.children = out;
  }
});

// Task lists: "- [ ] item" / "- [x] item".
md.core.ruler.after("inline", "task_lists", (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 2; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== "inline" || toks[i - 1].type !== "paragraph_open" || toks[i - 2].type !== "list_item_open") continue;
    const m = /^\[([ xX])\][ \t]/.exec(t.content) ?? /^\[([ xX])\]$/.exec(t.content);
    const first = t.children?.[0];
    if (!m || !first || first.type !== "text") continue;
    const checked = m[1] !== " ";
    first.content = first.content.slice(m[0].length);
    const line = toks[i - 2].map?.[0] ?? 0;
    const cb = new state.Token("html_inline", "", 0);
    cb.content = `<input type="checkbox" class="task-cb" data-task-line="${line}"${checked ? " checked" : ""} tabindex="-1">`;
    // Wrap the item's text in one box so it lays out as a single column next to the checkbox.
    const textOpen = Object.assign(new state.Token("html_inline", "", 0), { content: '<span class="task-text">' });
    const textClose = Object.assign(new state.Token("html_inline", "", 0), { content: "</span>" });
    t.children!.unshift(cb, textOpen);
    t.children!.push(textClose);
    toks[i - 2].attrJoin("class", checked ? "task done" : "task");
    // Mark the parent list so bullets can be hidden.
    for (let j = i - 3; j >= 0; j--) {
      if ((toks[j].type === "bullet_list_open" || toks[j].type === "ordered_list_open") && toks[j].level === toks[i - 2].level - 1) {
        if (!String(toks[j].attrGet("class") ?? "").includes("has-tasks")) toks[j].attrJoin("class", "has-tasks");
        break;
      }
    }
  }
});

// Wikilinks (from the original import): [[Target]] or [[Target|Alias]].
md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
  const end = src.indexOf("]]", start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  if (!inner || inner.includes("\n")) return false;
  if (!silent) {
    const [target, alias] = inner.split("|");
    const tok = state.push("html_inline", "", 0);
    const label = (alias ?? target.split("/").pop() ?? target).replace(/#.*/, "") || target;
    tok.content = `<a class="wikilink" data-wikilink="${escapeAttr(target.replace(/#.*/, ""))}">${md.utils.escapeHtml(label)}</a>`;
  }
  state.pos = end + 2;
  return true;
});

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const cache = new Map<string, string>();

export function renderMarkdown(src: string, key?: string): string {
  if (key) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }
  const html = md.render(src);
  if (key) {
    if (cache.size > 3000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

/** First chunk of a note for card previews, cut on a line boundary. */
export function previewSource(body: string, max = 1200): string {
  if (body.length <= max) return body;
  const cut = body.lastIndexOf("\n", max);
  return body.slice(0, cut > max * 0.5 ? cut : max) + "…";
}

/** Toggle the "- [ ]" marker on a given 0-based source line. */
export function toggleTaskLine(body: string, line: number): string {
  const lines = body.split("\n");
  const l = lines[line];
  if (l === undefined) return body;
  lines[line] = l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_, pre, c) => `${pre}[${c === " " ? "x" : " "}]`);
  return lines.join("\n");
}
