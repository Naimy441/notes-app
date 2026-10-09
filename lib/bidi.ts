/**
 * Per-line direction and Arabic-script helpers shared by the editor and the
 * rendered note cards.
 */

const ARABIC =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export const ARABIC_RUN =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;

export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

/** First strong character, or null when the line is neutral (digits, punctuation, empty). */
export function strongDir(text: string): "ltr" | "rtl" | null {
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (isRtl(cp)) return "rtl";
    if (isLtr(cp)) return "ltr";
  }
  return null;
}

/** Direction a line should use. Neutral lines keep the previous line's direction. */
export function lineDir(text: string, previous: "ltr" | "rtl" = "ltr"): "ltr" | "rtl" {
  return strongDir(text) ?? previous;
}

function isRtl(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

function isLtr(cp: number): boolean {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return true;
  if (cp >= 0xc0 && cp <= 0x02ff && cp !== 0xd7 && cp !== 0xf7) return true;
  if (cp >= 0x0370 && cp <= 0x058f) return true;
  if (cp >= 0x0900 && cp <= 0x1fff) return true;
  if (cp >= 0x2c00 && cp <= 0x2fef) return true;
  return false;
}
