"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "../../../lib/auth.ts";
import { discoverMetaPages, MetaAdminError, runMetaHandshakeSelfTest } from "../../../lib/integrations/meta-admin.ts";
import { loadMetaMappings, saveMetaMapping, validMetaBrand, validMetaId } from "../../../lib/integrations/meta-settings.ts";
import { BRANDS } from "../../../lib/leads/types.ts";
import type { MetaPage } from "../../../lib/integrations/meta-admin.ts";
import { reprocessRejectedMetaLead } from "../../../lib/integrations/meta-leadgen.ts";
import { syncDealToHubSpot } from "../../../lib/integrations/hubspot.ts";

export type MetaActionResult = { ok: boolean; message: string; pages?: MetaPage[] };
async function administrator() {
  const user = await getSessionUser();
  if (!user || user.role !== "administrator") throw new Error("Administrator access required");
  return user;
}
export async function reprocessMetaReceipt(leadgenId: string): Promise<MetaActionResult> {
  await administrator();
  if (!validMetaId(leadgenId)) return { ok: false, message: "Invalid Meta lead ID." };
  try {
    const result = await reprocessRejectedMetaLead(leadgenId, { syncHubSpot: syncDealToHubSpot });
    revalidatePath("/admin/lead-manager/meta");
    return {
      ok: result.status === "ingested",
      message: result.status === "ingested" ? "Receipt accepted. Review CRM delivery status; any sync failure remains in the existing retry queue."
        : result.status === "skipped" ? result.reason : "Receipt not ingested. Review its updated error and retry state.",
    };
  } catch {
    return { ok: false, message: "Reprocessing could not complete. Refresh the receipt before trying again." };
  }
}
export async function refreshMetaPages(): Promise<MetaActionResult> {
  await administrator();
  try {
    return { ok: true, message: "Page discovery completed. Check each Page for any access errors.", pages: await discoverMetaPages(await loadMetaMappings()) };
  } catch (error) {
    return { ok: false, message: error instanceof MetaAdminError ? error.category : "Page discovery unavailable; check database and Meta configuration" };
  }
}
export async function subscribeAllMetaPages(): Promise<MetaActionResult> {
  await administrator();
  try {
    const pages = await discoverMetaPages(await loadMetaMappings(), process.env, fetch, true);
    const ok = pages.length > 0 && pages.every(p => p.subscribed && !p.error);
    return { ok, message: ok ? "All visible Pages subscribed and verified." : "Not all Pages were verified. Review the individual results; no success is assumed.", pages };
  } catch (error) {
    return { ok: false, message: error instanceof MetaAdminError ? error.category : "Subscription unavailable; check database and Meta configuration" };
  }
}
export async function assignMetaMapping(form: FormData): Promise<MetaActionResult> {
  const user = await administrator();
  const kind = form.get("kind"), id = String(form.get("id") ?? ""), brand = form.get("brand");
  if ((kind !== "pages" && kind !== "forms") || !validMetaId(id) || !validMetaBrand(brand)) return { ok: false, message: `Choose an ID and one of the ${BRANDS.length} P5 brands.` };
  try {
    await saveMetaMapping(kind, id, brand, user.id, String(form.get("formName") ?? ""), String(form.get("service") ?? ""));
    revalidatePath("/admin/lead-manager/meta");
    return { ok: true, message: "Mapping saved. Future lead processing uses this assignment." };
  } catch { return { ok: false, message: "Mapping was not saved. Check database availability." }; }
}
export async function selfTestMetaHandshake(): Promise<MetaActionResult> {
  await administrator();
  // Next validates Server Action Origin/Host. Still require same-origin explicitly;
  // never accept a user-provided URL or fallback to a production APP_BASE_URL.
  const h = await headers();
  const origin = h.get("origin"), host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host) return { ok: false, message: "Cannot establish this request's origin; self-test not run." };
  try {
    if (new URL(origin).host !== host) return { ok: false, message: "Same-origin self-test required." };
    const ok = await runMetaHandshakeSelfTest(origin);
    return { ok, message: ok ? "PASS: this server echoed the verification challenge." : "FAIL: verification did not return the expected challenge (configuration, access or routing)." };
  } catch { return { ok: false, message: "Self-test failed; no external integrations were invoked." }; }
}
