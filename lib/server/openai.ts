/**
 * Minimal OpenAI client for the API routes.
 *
 * Env (set in Vercel → Project → Settings → Environment Variables):
 *   OPENAI_API_KEY            required
 *   OPENAI_MODEL              chat model for AI edits and filing (default gpt-4.1-mini)
 *   OPENAI_BASE_URL           optional, e.g. a proxy (default https://api.openai.com/v1)
 */

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function openaiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiError("AI isn't set up yet: add OPENAI_API_KEY to the server environment.", 503);
  return key;
}

const base = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

export const chatModel = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";

/** Turn an OpenAI error response into a short message that is safe to show. */
async function upstreamError(res: Response, what: string): Promise<AiError> {
  let detail = "";
  try {
    const data = await res.json();
    detail = typeof data?.error?.message === "string" ? data.error.message : "";
  } catch {}
  if (res.status === 401) return new AiError("The OpenAI key was rejected. Check OPENAI_API_KEY.", 502);
  if (res.status === 429) return new AiError("OpenAI is rate-limiting or out of credit. Try again shortly.", 429);
  return new AiError(detail ? `${what} failed: ${detail.slice(0, 200)}` : `${what} failed.`, 502);
}

export async function chatJson(opts: {
  system: string;
  user: string;
  temperature?: number;
  what: string;
}): Promise<unknown> {
  const key = openaiKey();
  let res: Response;
  try {
    res = await fetch(`${base()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel(),
        temperature: opts.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
  } catch {
    throw new AiError("Couldn't reach OpenAI.");
  }
  if (!res.ok) throw await upstreamError(res, opts.what);
  const data = await res.json();
  const choice = data?.choices?.[0];
  // A cut-off answer is incomplete JSON at best, and a truncated note at worst.
  if (choice?.finish_reason === "length") throw new AiError(`${opts.what} stopped early: the note is too long for one pass.`, 413);
  const text = choice?.message?.content;
  if (typeof text !== "string") throw new AiError(`${opts.what} returned nothing.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError(`${opts.what} returned an unreadable answer.`);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
