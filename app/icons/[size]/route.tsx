import { ImageResponse } from "next/og";
import { IconArt } from "@/lib/icon-art";

const SIZES = ["192", "512"];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const px = SIZES.includes(size) ? Number(size) : 512;
  return new ImageResponse(<IconArt size={px} />, { width: px, height: px });
}
