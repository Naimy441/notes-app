import { connection } from "next/server";
import { filingPayload, sanitizePlacements, type FilingNoteInput } from "@/lib/filing";
import { OWNER_EMAIL, WEB_API_KEY } from "@/lib/firebase";

export async function POST(req: Request) {
  await connection();

  const authed = await isOwner(req);
  if (!authed) return Response.json({ error: "Sign in required." }, { status: 401 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  }

  let payload: { action?: unknown; title?: unknown; body?: unknown; instruction?: unknown; folders?: unknown; notes?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (payload.action === "file") return fileNotes(payload, key);

  const title = typeof payload.title === "string" ? payload.title.slice(0, 500) : "";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 100_000) : "";
  const instruction = typeof payload.instruction === "string" ? payload.instruction.trim().slice(0, 4_000) : "";
  if (!title.trim() && !body.trim() && !instruction) {
    return Response.json({ error: "Nothing to edit." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const system = `You edit a note and return JSON {"title": string, "body": string} only.
Keep the user's language. Do not translate unless the instruction asks.
Never "correct", expand, or rewrite Arabic transliterations — Arabic words written in Latin letters (such as marhaba, inshallah, yalla, habibi, shukran, wallah, yaani, khalas). Leave those character-for-character as written.
Do not add commentary, fences, or keys other than title and body.`;

  const task = instruction
    ? `Apply this instruction to the note:\n${instruction}\n\nDo not correct Arabic transliterations unless the instruction explicitly asks.`
    : `Do both of these, and nothing else:
1. Add light Markdown formatting where it clearly helps (headings, lists, emphasis, links). Do not rewrite the prose.
2. Fix spelling mistakes.
Do not correct Arabic transliterations (Arabic words written with Latin letters); leave them exactly as written.`;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${task}\n\nTitle:\n${title}\n\nBody:\n${body}` },
        ],
      }),
    });
  } catch {
    return Response.json({ error: "Couldn't reach the AI service." }, { status: 502 });
  }

  if (!upstream.ok) {
    return Response.json({ error: "AI edit failed." }, { status: 502 });
  }

  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return Response.json({ error: "AI edit failed." }, { status: 502 });

  try {
    const parsed = JSON.parse(text) as { title?: unknown; body?: unknown };
    const nextTitle = typeof parsed.title === "string" ? parsed.title : title;
    const nextBody = typeof parsed.body === "string" ? parsed.body : null;
    if (nextBody == null) return Response.json({ error: "AI edit failed." }, { status: 502 });
    return Response.json({ title: nextTitle, body: nextBody });
  } catch {
    return Response.json({ error: "AI edit failed." }, { status: 502 });
  }
}

/** Suggest existing folders for unfiled notes. Does not create folders or rewrite text. */
async function fileNotes(payload: { folders?: unknown; notes?: unknown }, key: string) {
  if (!Array.isArray(payload.folders) || !Array.isArray(payload.notes)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const notes: FilingNoteInput[] = [];
  for (const n of payload.notes) {
    if (!n || typeof n !== "object") continue;
    const rec = n as { id?: unknown; title?: unknown; body?: unknown };
    if (typeof rec.id !== "string" || !rec.id.trim()) continue;
    notes.push({
      id: rec.id,
      title: typeof rec.title === "string" ? rec.title : "",
      body: typeof rec.body === "string" ? rec.body : "",
    });
  }
  const folders = payload.folders.filter((f): f is string => typeof f === "string");
  const request = filingPayload(folders, notes);
  if (!request.folders.length) return Response.json({ error: "No folders to file into." }, { status: 400 });
  if (!request.notes.length) return Response.json({ error: "Nothing to file." }, { status: 400 });

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const system = `You file notes into folders that already exist. Return JSON {"placements":[{"id":string,"folder":string|null}]} only.
Choose folder only from the given paths, copied exactly. Never invent, rename, or create a folder.
Never rewrite a note. Use null when no listed folder is a clear fit — leaving a note unfiled is correct.
Include every note id exactly once. No commentary, fences, or other keys.`;

  const listed = request.notes
    .map((n) => `id: ${n.id}\ntitle: ${n.title}\nbody:\n${n.body}`)
    .join("\n---\n");
  const user = `Folders:\n${request.folders.map((f) => `- ${f}`).join("\n")}\n\nUnfiled notes:\n${listed}`;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    return Response.json({ error: "Couldn't reach the AI service." }, { status: 502 });
  }

  if (!upstream.ok) return Response.json({ error: "AI filing failed." }, { status: 502 });

  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return Response.json({ error: "AI filing failed." }, { status: 502 });

  try {
    const parsed = JSON.parse(text) as unknown;
    const placements = sanitizePlacements(
      request.folders,
      request.notes.map((n) => n.id),
      parsed,
    );
    return Response.json({ placements });
  } catch {
    return Response.json({ error: "AI filing failed." }, { status: 502 });
  }
}

async function isOwner(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (await googleOwner(token)) return true;
  // The Auth emulator's ID tokens are not accepted by Google's lookup API.
  // Trust the owner claim only for a local dev server.
  return process.env.NODE_ENV !== "production" && isLocalHost(req) && localOwner(token);
}

function isLocalHost(req: Request) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1";
}

async function googleOwner(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const user = data.users?.[0] as { email?: string; emailVerified?: boolean } | undefined;
    return user?.email === OWNER_EMAIL && user.emailVerified === true;
  } catch {
    return false;
  }
}

/** Unsigned local-emulator token. Never used in production. */
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
