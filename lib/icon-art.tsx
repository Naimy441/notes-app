/**
 * App icon: the sign-in screen's logo — flat note cards in a two-column masonry
 * stack on the amber tile. Geometry is in a 64-unit box; app/icon.svg is generated
 * from it by scripts/build-icon-svg.mjs, and BrandGlyph (components/icons.tsx) draws the same cards.
 */
export const ICON = {
  bgFrom: "#FFD34D",
  bgTo: "#F2A900",
  card: "#FFFDF6",
  cards: [
    { x: 12, y: 11, w: 18, h: 24 },
    { x: 12, y: 39, w: 18, h: 14 },
    { x: 34, y: 11, w: 18, h: 14 },
    { x: 34, y: 29, w: 18, h: 24 },
  ],
  cardRadius: 4.5,
  /** Corner radius of the tile where we draw our own corners (browser tab); iOS/Android mask their own. */
  tileRadius: 18,
} as const;

/** Same art as JSX for next/og ImageResponse (PNG icons for iOS home screen and Android). */
export function IconArt({ size, rounded = false }: { size: number; rounded?: boolean }) {
  const s = size / 64;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        background: `linear-gradient(145deg, ${ICON.bgFrom}, ${ICON.bgTo})`,
        borderRadius: rounded ? ICON.tileRadius * s : 0,
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
            background: ICON.card,
          }}
        />
      ))}
    </div>
  );
}
