/** Read the whole workspace; edit project details; archive or restore. */

import { fail, ok, requireProject } from "../../../lib/scopes/http.ts";
import { reprice } from "../../../lib/scopes/engine.ts";
import { refreshEstimate } from "../../../lib/scopes/qbo.ts";
import { latestEstimate, logEvent, setProjectState, updateProjectFields, type EditableField } from "../../../lib/scopes/store.ts";
import { loadWorkspace } from "../../../lib/scopes/workspace.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
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
  const workspace = await loadWorkspace(g.project.id, g.user);
  return ok({ workspace, refreshError });
}

const FIELDS: EditableField[] = ["client_first_name", "client_last_name", "client_email", "client_phone", "project_address", "billing_address", "service", "finish_tier"];
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
    return ok({ workspace: await loadWorkspace(g.project.id, g.user) });
  } catch (error) {
    return fail(error);
  }
}

/** Delete the project here and remove what it put in QuickBooks (never the customer). Employees only. */
export async function DELETE(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    if (g.user.scopesOnly) throw new Error("Only P5 employees can delete a project.");
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "DELETE") throw new Error("Type DELETE to confirm.");
    const { deleteProjectEverywhere } = await import("../../../lib/scopes/qbo.ts");
    const { removed } = await deleteProjectEverywhere(g.project, g.user.id);
    return ok({ deleted: true, removed });
  } catch (error) {
    return fail(error);
  }
}

/** Project actions that are not edits: send files to QuickBooks and HubSpot, or look the property up again. */
export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    let summary: unknown = null;
    if (body.action === "sync-files") {
      const { syncProjectFiles } = await import("../../../lib/scopes/filesync.ts");
      summary = await syncProjectFiles(g.project.id, { deadline: Date.now() + 200_000 });
    } else if (body.action === "property") {
      const { ensureProperty, isPropertyLookupConfigured } = await import("../../../lib/scopes/property.ts");
      if (!isPropertyLookupConfigured()) throw new Error("Property lookup is not set up yet. Add RENTCAST_API_KEY in Replit Secrets.");
      if (!g.project.project_address) throw new Error("Save the project address first.");
      await ensureProperty(g.project, true);
    } else throw new Error("Unknown action.");
    return ok({ workspace: await loadWorkspace(g.project.id, g.user), summary });
  } catch (error) {
    return fail(error);
  }
}
