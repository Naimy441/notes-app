/**
 * App icon: a two-column masonry stack of note cards on an amber tile —
 * the same shape as the app's grid, so it reads clearly even at 16px.
 * Geometry is in a 64-unit box. app/icon.svg is generated from it by scripts/build-icon-svg.mjs.
 */
export const ICON = {
  bgFrom: "#FFD34E",
  bgTo: "#F2A100",
  card: "#FFFDF6",
  ink: "#3B2A00",
  line: "#E9C46A",
  lineOnDark: "#F6C445",
  // [x, y, w, h]; one dark accent card gives the mark its character.
  cards: [
    { x: 12, y: 11, w: 18, h: 24, dark: false, lines: true },
    { x: 12, y: 39, w: 18, h: 14, dark: false, lines: false },
    { x: 34, y: 11, w: 18, h: 14, dark: true, lines: true },
    { x: 34, y: 29, w: 18, h: 24, dark: false, lines: true },
  ],
  cardRadius: 4.5,
} as const;

/** Card text lines, only drawn at sizes where they're legible. */
const LINES = [
  { dy: 6, w: 11 },
  { dy: 10.5, w: 8 },
];

/** Same art as JSX for next/og ImageResponse (PNG icons for iOS home screen and Android). */
export function IconArt({ size, rounded = false }: { size: number; rounded?: boolean }) {
  const s = size / 64;
  const detailed = size >= 128;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        background: `linear-gradient(135deg, ${ICON.bgFrom}, ${ICON.bgTo})`,
        borderRadius: rounded ? 14 * s : 0,
      }}
    >
      {ICON.cards.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: c.x * s,
            top: c.y * s,
            width: c.w * s,
            height: c.h * s,
            borderRadius: ICON.cardRadius * s,
            background: c.dark ? ICON.ink : ICON.card,
            boxShadow: detailed ? `0 ${1.2 * s}px ${3 * s}px rgba(120, 70, 0, 0.28)` : "none",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {detailed &&
            c.lines &&
            LINES.map((l, j) => (
              <div
                key={j}
                style={{
                  position: "absolute",
                  left: 3.5 * s,
                  top: l.dy * s - 1.1 * s,
                  width: l.w * s,
                  height: 2.2 * s,
                  borderRadius: 2 * s,
                  background: c.dark ? ICON.lineOnDark : ICON.line,
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
