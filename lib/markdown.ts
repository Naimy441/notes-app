import MarkdownIt, { type StateCore, type StateInline } from "markdown-it";

// html: false escapes any raw HTML in notes, so rendered output is safe to inject.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Tag every block with its source line so a tap in preview can place the caret there.
md.core.ruler.push("source_lines", (state: StateCore) => {
  for (const t of state.tokens) {
    if (t.map && t.nesting === 1) {
      t.attrSet("data-line", String(t.map[0]));
      t.attrSet("data-line-end", String(t.map[1] - 1));
    }
  }
});

// GitHub/Obsidian task lists: "- [ ] item" / "- [x] item".
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
    t.children!.unshift(cb);
    toks[i - 2].attrJoin("class", checked ? "task done" : "task");
    // Mark the parent list so bullets can be hidden.
    for (let j = i - 3; j >= 0; j--) {
      if ((toks[j].type === "bullet_list_open" || toks[j].type === "ordered_list_open") && toks[j].level === toks[i - 2].level - 1) {
        toks[j].attrJoin("class", "has-tasks");
        break;
      }
    }
  }
});

// Obsidian wikilinks: [[Target]] or [[Target|Alias]].
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
