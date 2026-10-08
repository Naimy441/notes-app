/** App icon drawn for ImageResponse: an amber tile with a note sheet and folded corner. */
export function IconArt({ size, rounded = false }: { size: number; rounded?: boolean }) {
  const s = size / 100;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #ffd54f 0%, #f5b000 55%, #e89a00 100%)",
        borderRadius: rounded ? 22 * s : 0,
      }}
    >
      <div
        style={{
          width: 50 * s,
          height: 60 * s,
          display: "flex",
          flexDirection: "column",
          gap: 6.5 * s,
          padding: `${14 * s}px ${10 * s}px`,
          background: "#fffdf6",
          borderRadius: 7 * s,
          borderTopRightRadius: 16 * s,
          boxShadow: `0 ${4 * s}px ${12 * s}px rgba(120,70,0,0.28)`,
        }}
      >
        <div style={{ height: 4.5 * s, width: "82%", borderRadius: 3 * s, background: "#3a2a00" }} />
        <div style={{ height: 3.2 * s, width: "100%", borderRadius: 3 * s, background: "#c9b48a" }} />
        <div style={{ height: 3.2 * s, width: "92%", borderRadius: 3 * s, background: "#c9b48a" }} />
        <div style={{ height: 3.2 * s, width: "64%", borderRadius: 3 * s, background: "#c9b48a" }} />
      </div>
    </div>
  );
}
