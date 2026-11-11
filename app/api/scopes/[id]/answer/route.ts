/** Save one wizard answer (or save it for later). Every answer is a new scope version. */

import { fail, ok, requireProject } from "../../../../lib/scopes/http.ts";
import { answerQuestion } from "../../../../lib/scopes/engine.ts";
import { loadWorkspace } from "../../../../lib/scopes/workspace.ts";
import type { Answer } from "../../../../lib/scopes/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const body = (await request.json()) as { key?: string; answer?: Answer | null; defer?: boolean; assetId?: number | null; prompt?: string };
    if (!body.key || !/^[a-z-]+:[^\s]{1,200}$/.test(body.key)) throw new Error("Unknown question.");
    await answerQuestion({
      projectId: g.project.id,
      key: body.key,
      answer: body.answer ?? null,
      defer: body.defer === true,
      assetId: typeof body.assetId === "number" ? body.assetId : null,
      userId: g.user.id,
      prompt: body.prompt?.slice(0, 300),
    });
    return ok({ workspace: await loadWorkspace(g.project.id, g.user) });
  } catch (error) {
    return fail(error);
  }
}
