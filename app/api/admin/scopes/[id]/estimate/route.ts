/**
 * QuickBooks actions for one project: find or create the customer, create or
 * revise the estimate (never sent from here), refresh its status, and link
 * the QuickBooks project once that separate step is confirmed.
 */

import { NextResponse } from "next/server";

import { compute, commitDoc, currentDoc } from "../../../../../lib/scopes/engine.ts";
import { fail, ok, requireProject } from "../../../../../lib/scopes/http.ts";
import {
  buildPayloadFor,
  createOrReviseEstimate,
  createProjectInQbo,
  customerProjects,
  ensureCustomer,
  findCustomerCandidates,
  linkProject,
  qboState,
  refreshEstimate,
} from "../../../../../lib/scopes/qbo.ts";
import { getProject, latestEstimate, loadScopeSettings } from "../../../../../lib/scopes/store.ts";
import { canonical } from "../../../../../lib/scopes/types.ts";
import { loadWorkspace } from "../../../../../lib/scopes/workspace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const REQUIRED: [string, string][] = [
  ["client_first_name", "first name"],
  ["client_last_name", "last name"],
  ["client_email", "email"],
  ["client_phone", "phone number"],
  ["project_address", "project address"],
];

export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string; qboId?: string; create?: boolean; overwrite?: boolean; refresh?: boolean };
  try {
    const state = await qboState();
    if (!state.connected) throw new Error(state.configured ? "QuickBooks is not connected. An administrator can connect it from Finance." : "QuickBooks is not configured for this deployment.");
    const project = g.project;
    switch (body.action) {
      case "customers":
        return ok({ candidates: await findCustomerCandidates(project) });
      case "customer":
        await ensureCustomer(project, body.create ? { create: true } : { qboId: String(body.qboId ?? "") }, g.user.id);
        break;
      case "create": {
        const missing = REQUIRED.filter(([k]) => !project[k as keyof typeof project]).map(([, label]) => label);
        if (missing.length) throw new Error(`Confirm the client's ${missing.join(", ")} first.`);
        if (!project.qbo_customer_id) throw new Error("Choose the QuickBooks customer first.");
        const settings = await loadScopeSettings();
        let { version, doc } = await currentDoc(project);
        if (!version) throw new Error("There is no scope yet.");
        const fresh = await compute(project, doc, settings);
        if (fresh.readiness.status !== "ready") throw new Error(`The estimate is not ready: ${fresh.readiness.blockers.slice(0, 3).join(" ")}`);
        // The estimate must point at an exact saved version: if pricing moved
        // (settings changed since the last save), save it as a version first.
        if (canonical(fresh.pricing) !== canonical(version.pricing)) {
          ({ version } = await commitDoc(project, doc, "repriced", "Repriced before creating the estimate", g.user.id));
          doc = version.doc;
        }
        const pricing = version.pricing!;
        const latest = (await getProject(project.id))!;
        const { payload, missingItems } = await buildPayloadFor(latest, version, pricing, doc, settings);
        if (missingItems.length) throw new Error(`These QuickBooks items were not found: ${missingItems.join(", ")}. An administrator can map them in Pricing setup.`);
        if (!payload) throw new Error("The estimate could not be prepared.");
        await createOrReviseEstimate({ project: latest, version, payload, userId: g.user.id, overwriteQuickBooksChanges: body.overwrite === true });
        break;
      }
      case "refresh": {
        const e = await latestEstimate(project.id);
        if (e) await refreshEstimate(e);
        break;
      }
      case "projects":
        if (!project.qbo_customer_id) throw new Error("Link the QuickBooks customer first.");
        return ok({ projects: await customerProjects(project.qbo_customer_id, body.refresh === true) });
      case "link-project":
        await linkProject(project, String(body.qboId ?? ""), g.user.id);
        break;
      case "create-project":
        await createProjectInQbo(project, g.user.id);
        break;
      default:
        throw new Error("Unknown action.");
    }
    return ok({ workspace: await loadWorkspace(project.id) });
  } catch (error) {
    const message = (error as Error).message;
    const res = fail(error, /already in progress/.test(message) ? 409 : 400) as NextResponse;
    return res;
  }
}
