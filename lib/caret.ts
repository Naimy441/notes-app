/**
 * Tap-to-edit: turn a tap on the rendered (Markdown) preview into the matching
 * character offset in the raw note text, so the editor opens with the caret
 * exactly where you touched.
 */

/** The text node + offset under a screen point, across browser APIs. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

const isSpace = (c: string) => /\s/.test(c);

/**
 * Map a tap inside a rendered block (an element carrying `data-line`/`data-line-end`)
 * to an offset in `body`. The text rendered before the tap is matched, character by
 * character, against the block's source lines; Markdown syntax that doesn't render
 * (`**`, `- [ ] `, `#`, link URLs…) is skipped over. Returns null if it can't tell.
 */
export function sourceOffsetFromTap(block: HTMLElement, x: number, y: number, body: string): number | null {
  const hit = caretAt(x, y);
  if (!hit || !block.contains(hit.node)) return null;

  const range = document.createRange();
  range.setStart(block, 0);
  try {
    range.setEnd(hit.node, hit.offset);
  } catch {
    return null;
  }
  const before = range.toString();

  const lines = body.split("\n");
  const first = Number(block.dataset.line);
  const last = Number(block.dataset.lineEnd ?? block.dataset.line);
  if (!Number.isFinite(first) || first >= lines.length) return null;
  let base = 0;
  for (let i = 0; i < first; i++) base += lines[i].length + 1;
  const src = lines.slice(first, Math.min(last, lines.length - 1) + 1).join("\n");

  // Walk the rendered characters through the source, ignoring whitespace differences
  // (line breaks render as separate lines, runs of spaces collapse, etc.).
  let at = 0;
  for (const ch of before) {
    if (isSpace(ch)) continue;
    const j = src.indexOf(ch, at);
    if (j < 0) break;
    at = j + 1;
  }
  // Tapped just after a space: keep the caret after it, as it appeared on screen.
  if (before && isSpace(before[before.length - 1]) && isSpace(src[at] ?? "")) at++;
  // Tapped at the very start of a block: skip leading syntax like "- [ ] " or "## ".
  if (!before.trim()) at = src.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s*)?/)?.[0].length ?? 0;
  return base + Math.min(at, src.length);
}

/** Pixel offset of a caret position from the top of a textarea (mirror-element technique). */
export function caretTopInTextarea(ta: HTMLTextAreaElement, pos: number): number {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const p of [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "tabSize",
    "unicodeBidi",
    "direction",
  ] as const) {
    mirror.style[p] = cs[p];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}
