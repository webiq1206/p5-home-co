/** Short dictation for a wizard field or a note: audio in, text out. Nothing is stored. */

import { transcribe, isAiConfigured } from "../../../../lib/scopes/ai.ts";
import { fail, ok, requireEmployee } from "../../../../lib/scopes/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  if (!isAiConfigured()) return fail(new Error("Dictation needs OPENAI_API_KEY in Replit Secrets."), 503);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("No audio was received.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Dictation is limited to a few minutes.");
    const t = await transcribe(Buffer.from(await file.arrayBuffer()), file.name || "dictation.webm", file.type || "audio/webm");
    return ok({ text: t.text.trim() });
  } catch (error) {
    return fail(error);
  }
}
