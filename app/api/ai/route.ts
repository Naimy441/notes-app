import { connection } from "next/server";
import { filingPayload, sanitizePlacements, type FilingNoteInput } from "@/lib/filing";
import { isOwner, unauthorized } from "@/lib/server/auth";
import { AiError, chatJson, errorResponse } from "@/lib/server/openai";

// Long notes are refused rather than cut: editing a truncated copy would drop
// the rest of the note when the result is saved.
const TITLE_LIMIT = 1_000;
const BODY_LIMIT = 60_000;

const RULES = `Keep the user's language; never translate unless asked.
Leave Arabic script exactly as written, including diacritics.
Never "correct", expand, or rewrite Arabic transliterations — Arabic words in Latin letters (inshallah, alhamdulillah, wallahi, subhanAllah, yaani, habibi, salah, dua, sunnah, ...). Keep them character-for-character.
Keep Markdown that is already there: checklists (- [ ] / - [x]), links, [[wikilinks]], tables, code.
Don't add commentary, introductions, or sign-offs.`;

export async function POST(req: Request) {
  await connection();
  if (!(await isOwner(req))) return unauthorized();

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    if (payload.action === "file") return Response.json(await fileNotes(payload));
    if (payload.action === "fixSpeech") return Response.json(await fixSpeech(payload));
    return Response.json(await editNote(payload));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Clean up a short speech-to-text span without rewriting the rest of the note. */
async function fixSpeech(payload: Record<string, unknown>) {
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!text.trim()) throw new AiError("Nothing to fix.", 400);
  if (text.length > 20_000) throw new AiError("That dictation is too long to clean up in one go.", 413);

  const result = await chatJson({
    what: "Speech cleanup",
    temperature: 0.1,
    system: `You clean up speech-to-text. Reply with JSON {"text": string} and nothing else.
Fix grammar, spelling, and punctuation only. Keep the speaker's meaning, wording, and language.
Leave Arabic script and Arabic transliterations unchanged character-for-character.
Do not add commentary, titles, markdown, or quotation marks the speaker did not say.
Do not translate. If the text is already fine, return it unchanged.`,
    user: text,
  });
  const parsed = result as { text?: unknown };
  if (typeof parsed.text !== "string") throw new AiError("Speech cleanup returned nothing.");
  return { text: parsed.text };
}

async function editNote(payload: Record<string, unknown>) {
  const title = typeof payload.title === "string" ? payload.title : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const instruction = typeof payload.instruction === "string" ? payload.instruction.trim().slice(0, 4_000) : "";
  if (title.length > TITLE_LIMIT || body.length > BODY_LIMIT) {
    throw new AiError("This note is too long to edit with AI in one go.", 413);
  }
  if (!title.trim() && !body.trim() && !instruction) throw new AiError("Nothing to edit.", 400);

  const task = instruction
    ? `Apply this instruction to the note, and change nothing else:\n${instruction}`
    : `Tidy this note, and do nothing else:
1. Fix spelling, typos and obvious punctuation mistakes in English text.
2. Add light Markdown where it clearly helps readability — headings for clear sections, bullet or numbered lists for list-like lines, checklists for to-dos. Don't reword sentences, merge or split paragraphs, or remove anything.
If the note is already fine, return it unchanged.`;

  const result = await chatJson({
    what: "AI edit",
    system: `You edit a single note. Reply with JSON {"title": string, "body": string} and nothing else.\n${RULES}`,
    user: `${task}\n\nTitle:\n${title}\n\nBody:\n${body}`,
  });
  const parsed = result as { title?: unknown; body?: unknown };
  if (typeof parsed.body !== "string") throw new AiError("AI edit returned no note.");
  return { title: typeof parsed.title === "string" ? parsed.title : title, body: parsed.body };
}

/** Suggest existing folders for unfiled notes. Never creates folders or rewrites text. */
async function fileNotes(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.folders) || !Array.isArray(payload.notes)) throw new AiError("Invalid request.", 400);
  const notes: FilingNoteInput[] = [];
  for (const n of payload.notes) {
    if (!n || typeof n !== "object") continue;
    const rec = n as { id?: unknown; title?: unknown; body?: unknown };
    if (typeof rec.id !== "string" || !rec.id.trim()) continue;
    notes.push({ id: rec.id, title: typeof rec.title === "string" ? rec.title : "", body: typeof rec.body === "string" ? rec.body : "" });
  }
  const folders = payload.folders.filter((f): f is string => typeof f === "string");
  const request = filingPayload(folders, notes);
  if (!request.folders.length) throw new AiError("There are no folders to file into.", 400);
  if (!request.notes.length) throw new AiError("Nothing to file.", 400);

  const listed = request.notes.map((n) => `id: ${n.id}\ntitle: ${n.title || "(untitled)"}\nbody:\n${n.body}`).join("\n---\n");
  const result = await chatJson({
    what: "AI filing",
    temperature: 0,
    system: `You file notes into folders that already exist. Reply with JSON {"placements":[{"id":string,"folder":string|null}]} and nothing else.
Pick a folder only from the given paths, copied exactly, preferring the most specific subfolder that fits.
Never invent, rename, or create a folder. Use null when no listed folder is a clear fit — leaving a note unfiled is correct.
Include every note id exactly once.`,
    user: `Folders:\n${request.folders.map((f) => `- ${f}`).join("\n")}\n\nUnfiled notes:\n${listed}`,
  });
  return { placements: sanitizePlacements(request.folders, request.notes.map((n) => n.id), result) };
}
