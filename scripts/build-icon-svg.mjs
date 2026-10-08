// Regenerates app/icon.svg from the geometry in lib/icon-art.tsx (run after changing the icon).
import fs from "node:fs";

const src = fs.readFileSync(new URL("../lib/icon-art.tsx", import.meta.url), "utf8");
const pick = (k) => src.match(new RegExp(`${k}: "([^"]+)"`))[1];
const cards = [...src.matchAll(/\{ x: (\d+), y: (\d+), w: (\d+), h: (\d+) \}/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
const r = src.match(/cardRadius: ([\d.]+)/)[1];
const rects = cards
  .map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${r}" fill="${pick("card")}"/>`)
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pick("bgFrom")}"/><stop offset="1" stop-color="${pick("bgTo")}"/></linearGradient></defs><rect width="64" height="64" rx="${src.match(/tileRadius: (\d+)/)[1]}" fill="url(#g)"/>${rects}</svg>\n`;
fs.writeFileSync(new URL("../app/icon.svg", import.meta.url), svg);
console.log(svg);
