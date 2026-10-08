"use server";

import { headers } from "next/headers";
import { getSessionUser } from "../../../lib/auth.ts";
import { getPool } from "../../../lib/db.ts";
import { InboxHubSpot } from "../../../lib/integrations/inbox-hubspot.ts";
import { authorizeDiagnostic, readOwnerSource, runOwnerDiagnostic, type DiagnosticResult } from "../../../lib/integrations/inbox-diagnostic.ts";
import { protectRequest } from "../../../../lib/p5/http.ts";
import { estimatorRelease } from "../../../../lib/p5/version.ts";

export type InboxDiagnosticActionResult = DiagnosticResult & { release?: { sha: string; sourceDigest: string; builtAt: string; dirty: boolean } };

async function execute(mode: "probe" | "write", form: FormData): Promise<InboxDiagnosticActionResult> {
  try {
    const actor = await getSessionUser(), requestHeaders = await headers();
    // Each action re-authorizes; neither the layout nor a prior browser result
    // grants access. Next Server Actions also enforce their Origin/Host check.
    authorizeDiagnostic(actor, requestHeaders.get("origin"));
    protectRequest(new Request("https://p5homeco.com/admin/finance/health", { method: "POST", headers: requestHeaders }), 6);
    const result = await runOwnerDiagnostic(mode, { actor, origin: requestHeaders.get("origin"),
      confirmed: form.get("confirmOwnerDiagnostic") === "yes" }, {
      env: process.env,
      read: async (text, values = []) => {
        const request = { text, values: [...values], query_timeout: 10_000 };
        return (await getPool().query(request)).rows;
      },
      crm: (token, deadline) => new InboxHubSpot(token, fetch, deadline), source: readOwnerSource,
    });
    const { sha, sourceDigest, builtAt, dirty } = estimatorRelease();
    return { ...result, release: { sha, sourceDigest, builtAt, dirty } };
  } catch {
    // No environment values, raw database errors or provider bodies cross
    // this authenticated UI boundary, including on authentication failures.
    return { ok: false, code: "diagnostic-request-not-authorized-or-unavailable", customerRecoveries: 0, writeVerified: false };
  }
}
export async function checkInboxBinding(_previous: InboxDiagnosticActionResult | null, form: FormData) {
  return execute("probe", form);
}
export async function testOwnerEmailActivity(_previous: InboxDiagnosticActionResult | null, form: FormData) {
  return execute("write", form);
}
