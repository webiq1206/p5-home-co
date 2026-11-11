/** Read the whole workspace; edit project details; archive or restore. */

import { fail, ok, requireProject } from "../../../../lib/scopes/http.ts";
import { reprice } from "../../../../lib/scopes/engine.ts";
import { refreshEstimate } from "../../../../lib/scopes/qbo.ts";
import { latestEstimate, logEvent, setProjectState, updateProjectFields, type EditableField } from "../../../../lib/scopes/store.ts";
import { loadWorkspace } from "../../../../lib/scopes/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  let refreshError: string | null = null;
  if (new URL(request.url).searchParams.get("refresh") === "1") {
    const e = await latestEstimate(g.project.id);
    if (e) await refreshEstimate(e).catch((err: Error) => (refreshError = err.message));
  }
  const workspace = await loadWorkspace(g.project.id);
  return ok({ workspace, refreshError });
}

const FIELDS: EditableField[] = ["title", "client_first_name", "client_last_name", "client_email", "client_phone", "project_address", "billing_address", "service", "finish_tier"];
const TIERS = new Set(["builder", "mid", "high", "luxury"]);

export async function PATCH(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.archived === "boolean") {
      await setProjectState(g.project.id, { archived: body.archived });
      await logEvent(g.project.id, body.archived ? "archived" : "restored", null, g.user.id);
    }
    const fields: Partial<Record<EditableField, string | null>> = {};
    for (const f of FIELDS) {
      if (f in body) fields[f] = body[f] === null ? null : String(body[f]).slice(0, 300);
    }
    if (fields.finish_tier && !TIERS.has(fields.finish_tier)) delete fields.finish_tier;
    await updateProjectFields(g.project.id, fields);
    if ("service" in fields || "finish_tier" in fields) await reprice(g.project.id, g.user.id, "Service or finish tier changed");
    return ok({ workspace: await loadWorkspace(g.project.id) });
  } catch (error) {
    return fail(error);
  }
}
