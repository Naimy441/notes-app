import { ImageResponse } from "next/og";
import { IconArt } from "@/lib/icon-art";

// PNG fallback for browsers that don't use the SVG favicon (app/icon.svg).
export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<IconArt size={48} rounded />, size);
}
