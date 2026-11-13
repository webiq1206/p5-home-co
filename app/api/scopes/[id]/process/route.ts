/**
 * Transcribe new recordings and build or update the scope. Long running; the
 * workspace polls the project while this runs, and a dropped request is
 * picked up by the next call (the lock expires after 15 minutes).
 */

import { fail, ok, requireProject } from "../../../../lib/scopes/http.ts";
import { isAiConfigured } from "../../../../lib/scopes/ai.ts";
import { processProject } from "../../../../lib/scopes/engine.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  if (!isAiConfigured()) return fail(new Error("No OpenAI key was found (OPENAI_API_KEY in Replit Secrets), so recordings cannot be transcribed yet."), 503);
  const result = await processProject(g.project.id, g.user.id);
  return result.ok ? ok({ message: result.message, partial: result.partial === true }) : fail(new Error(result.message), 409);
}
