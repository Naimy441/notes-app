/**
 * Server-side check that a request comes from the owner's signed-in account.
 * The browser sends its Firebase ID token as a Bearer header.
 */
import { OWNER_EMAIL, WEB_API_KEY } from "../config";

export async function isOwner(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (await googleOwner(token)) return true;
  // The Auth emulator's ID tokens are unsigned and Google's lookup rejects them.
  // Trust their owner claim only on a local dev server.
  return process.env.NODE_ENV !== "production" && isLocalHost(req) && localOwner(token);
}

function isLocalHost(req: Request) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1";
}

// A few seconds of caching saves a round trip per AI call or dictation chunk.
const verified = new Map<string, number>();

async function googleOwner(token: string): Promise<boolean> {
  const until = verified.get(token);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const user = data.users?.[0] as { email?: string; emailVerified?: boolean } | undefined;
    const ok = user?.email === OWNER_EMAIL && user.emailVerified === true;
    if (ok) {
      if (verified.size > 50) verified.clear();
      verified.set(token, Date.now() + 5 * 60_000);
    }
    return ok;
  } catch {
    return false;
  }
}

/** Unsigned local-emulator token. Never accepted in production. */
function localOwner(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      email_verified?: boolean;
    };
    return json.email === OWNER_EMAIL && json.email_verified === true;
  } catch {
    return false;
  }
}

export const unauthorized = () => Response.json({ error: "Sign in required." }, { status: 401 });
