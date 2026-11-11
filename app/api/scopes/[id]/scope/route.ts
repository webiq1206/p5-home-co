/** Edit the scope by hand, or accept / reject proposed changes from new material. */

import { fail, ok, requireProject } from "../../../../lib/scopes/http.ts";
import { acceptProposal, editScope, rejectProposal, type EditOp } from "../../../../lib/scopes/engine.ts";
import { loadWorkspace } from "../../../../lib/scopes/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const body = (await request.json()) as { action: string; ops?: EditOp[]; ids?: string[] };
    if (body.action === "edit") {
      if (!Array.isArray(body.ops) || !body.ops.length) throw new Error("Nothing to save.");
      await editScope(g.project.id, body.ops, g.user.id);
    } else if (body.action === "accept") {
      await acceptProposal(g.project.id, Array.isArray(body.ids) ? body.ids.map(String) : [], g.user.id);
    } else if (body.action === "reject") {
      await rejectProposal(g.project.id, g.user.id);
    } else throw new Error("Unknown action.");
    return ok({ workspace: await loadWorkspace(g.project.id, g.user) });
  } catch (error) {
    return fail(error);
  }
}
