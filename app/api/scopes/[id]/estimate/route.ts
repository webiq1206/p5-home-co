/**
 * QuickBooks actions for one project: find or create the customer, create or
 * revise the estimate (never sent from here), refresh its status, and link
 * the QuickBooks project once that separate step is confirmed.
 */

import { after, NextResponse } from "next/server";

import { syncProjectFiles } from "../../../../lib/scopes/filesync.ts";

import { currentDoc } from "../../../../lib/scopes/engine.ts";
import { fail, ok, requireEmployee } from "../../../../lib/scopes/http.ts";
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
  sendEstimate,
} from "../../../../lib/scopes/qbo.ts";
import { getProject, latestEstimate, loadScopeSettings } from "../../../../lib/scopes/store.ts";
import { can } from "../../../../lib/leads/permissions.ts";
import { qboRequest } from "../../../../lib/finance/qbo/client.ts";
import { loadWorkspace } from "../../../../lib/scopes/workspace.ts";

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
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  // Check permission before resolving the project or consulting accounting.
  // Even refresh and name lookup can write to the local accounting mirror.
  if (g.user.scopesOnly || !can(g.user.role, "manage_integrations")) {
    return fail(new Error("Only P5 administrators can use the QuickBooks estimate controls."), 403);
  }
  const id = Number((await params).id);
  const project = Number.isSafeInteger(id) && id > 0 ? await getProject(id) : null;
  if (!project) return fail(new Error("Project not found."), 404);
  const body = (await request.json().catch(() => ({}))) as { action?: string; qboId?: string; create?: boolean; overwrite?: boolean; refresh?: boolean; email?: string };
  try {
    const state = await qboState();
    if (!state.connected) throw new Error(state.configured ? "QuickBooks is not connected. An administrator can connect it from Finance." : "QuickBooks is not configured for this deployment.");
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
        if (!project.qbo_project_id) throw new Error("Link the QuickBooks project first.");
        const { version, doc } = await currentDoc(project);
        if (!version?.pricing || !version.pricing.policy?.costBookVersion) {
          throw new Error("Save a priced scope version before creating a QuickBooks estimate.");
        }
        if (project.scope_status !== "ready") throw new Error("Mark the saved scope ready before creating a QuickBooks estimate.");
        // The provider handoff never calls the current pricing engine. It sends
        // the selected immutable saved price, not the catalog active today.
        const response = await qboRequest<{ Customer?: { Id?: string; Active?: boolean; IsProject?: boolean; ParentRef?: { value?: string } } }>(
          `/customer/${encodeURIComponent(project.qbo_project_id)}`);
        const linked = response.Customer;
        if (linked?.Id !== project.qbo_project_id || linked?.Active !== true ||
            linked?.IsProject !== true || linked.ParentRef?.value !== project.qbo_customer_id) {
          throw new Error("QuickBooks did not verify the active project under the linked customer. Check the project link.");
        }
        const settings = await loadScopeSettings();
        const pricing = version.pricing;
        const latest = await getProject(project.id);
        if (!latest || latest.current_version_id !== version.id || latest.scope_status !== "ready" ||
            latest.qbo_customer_id !== project.qbo_customer_id || latest.qbo_project_id !== project.qbo_project_id) {
          throw new Error("The saved scope or QuickBooks project changed. Reload and review before creating the estimate.");
        }
        const { payload, missingItems } = await buildPayloadFor(latest, version, pricing, doc, settings);
        if (missingItems.length) throw new Error(`These QuickBooks items were not found: ${missingItems.join(", ")}. An administrator can map them in Pricing setup.`);
        if (!payload) throw new Error("The estimate could not be prepared.");
        payload.PrivateNote = `${payload.PrivateNote} Cost book version: ${pricing.policy.costBookVersion}.`.slice(0, 4000);
        const prior = await latestEstimate(project.id);
        if (prior?.qbo_estimate_id && prior.txn_status !== "Deleted") {
          const preview = await qboRequest<{ Estimate?: { Id?: string; TxnStatus?: string; EmailStatus?: string; CustomerRef?: { value?: string } } }>(
            `/estimate/${encodeURIComponent(prior.qbo_estimate_id)}`);
          const live = preview.Estimate;
          if (live?.Id !== prior.qbo_estimate_id ||
              live.TxnStatus !== "Pending" || live.EmailStatus !== "NotSet") {
            throw new Error("Only an unsent QuickBooks draft can be updated. Issued estimates stay at their original pricing.");
          }
          if (live.CustomerRef?.value !== latest.qbo_project_id) {
            throw new Error("The saved QuickBooks draft belongs to a different customer or project. It was not updated.");
          }
        }
        const saved = await createOrReviseEstimate({ project: latest, version, payload, userId: g.user.id, overwriteQuickBooksChanges: body.overwrite === true });
        const receipt = await latestEstimate(project.id);
        if (!receipt || receipt.qbo_estimate_id !== saved.qboId || receipt.version_id !== version.id || !receipt.drift || receipt.drift.changed) {
          throw new Error("QuickBooks returned an estimate, but its readback did not reconcile. It was not emailed. Open the saved estimate and resolve the differences.");
        }
        break;
      }
      case "send": {
        const e = await latestEstimate(project.id);
        if (!e) throw new Error("Create the estimate first.");
        // The screen states the address it is sending to; refuse if that is no longer the saved one.
        if (String(body.email ?? "").trim().toLowerCase() !== (project.client_email ?? "").trim().toLowerCase()) {
          throw new Error("The client's email changed. Check it and send again.");
        }
        const version = (await currentDoc(project)).version;
        if (version && e.version_id !== version.id) throw new Error("The scope changed after this estimate was created. Update the estimate before sending it.");
        await refreshEstimate(e);
        const live = await latestEstimate(project.id);
        if (!live || live.qbo_estimate_id !== e.qbo_estimate_id || live.status_error || !live.drift || live.drift.changed) {
          throw new Error("The QuickBooks estimate did not reconcile with the saved scope. It was not sent.");
        }
        if (live.txn_status !== "Pending") throw new Error("This estimate is no longer open in QuickBooks, so it was not sent.");
        await sendEstimate(project, live, g.user.id);
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
    // A newly chosen customer or a new estimate gives the project's files somewhere to go in QuickBooks.
    if (body.action === "customer" || body.action === "create") {
      after(() => syncProjectFiles(project.id, { deadline: Date.now() + 120_000 }).catch(() => undefined));
    }
    return ok({ workspace: await loadWorkspace(project.id, g.user) });
  } catch (error) {
    const message = (error as Error).message;
    const res = fail(error, /already in progress/.test(message) ? 409 : 400) as NextResponse;
    return res;
  }
}
