import { BrandGlyph } from "./icons";

/**
 * Launch screen painted before the app code loads (or while auth is resolving).
 * Neutral on purpose: at this point we don't know whether you're signed in, so it
 * shows only the logo — and only fades in if loading is slow enough to notice.
 */
export function Splash() {
  return (
    <div className="launch" aria-label="Loading Notes">
      <div className="launch-logo">
        <BrandGlyph size={44} />
      </div>
    </div>
  );
}
