/** Bounded Graph control plane. Tokens never occur in URLs, results or errors. */
import { query } from "../db.ts";
import { getSmtpConfig } from "../notifications/smtp-config.ts";
import { metaConfig, META_LEAD_FORMS, resolveMetaBrand } from "./meta-leadgen.ts";
import { loadMetaMappings, validMetaId, type MetaMappings } from "./meta-settings.ts";
import { graphList, metaGraph, MetaAdminError, type MetaFetch } from "./meta-graph.ts";
import { refreshMetaPageTokens, resolveMetaPageToken } from "./meta-page-tokens.ts";
import { metaDiagnostic } from "./meta-diagnostics.ts";
export { metaGraph, MetaAdminError } from "./meta-graph.ts";
export type { MetaFetch } from "./meta-graph.ts";

type Env = Record<string, string | undefined>;
export type MetaForm = { id: string; name: string; status: string; questions: { key?: string; label?: string; type?: string }[]; brand: string; resolvedBy: string };
export type MetaPage = { id: string; name: string; appId: string; appPresent: boolean | null; subscribed: boolean | null; error: string | null; forms: MetaForm[] };
export type MetaReceipt = {
  leadgen_id: string; page_id: string | null; form_id: string | null; state: string;
  attempts: number; last_error: string | null; received_at: string; updated_at: string;
  lease_until: string | null; hubspot_contact_id: string | null; hubspot_deal_id: string | null;
  sync_status: string | null; retry_at: string | null;
};
export function metaReadiness(env: Env = process.env) {
  let smtpEnabled = false;
  try { getSmtpConfig(env); smtpEnabled = true; } catch { /* configuration only, never sends */ }
  return {
    secrets: Object.fromEntries(["META_LEADGEN_VERIFY_TOKEN", "META_APP_SECRET", "META_PAGE_ACCESS_TOKEN", "META_PAGE_TOKENS", "HUBSPOT_TOKEN", "SMTP_USER", "SMTP_PASSWORD"].map(k => [k, Boolean(env[k]?.trim())])),
    appId: env.META_APP_ID?.trim() || null, smtpEnabled,
  };
}
export function isLeadgenSubscribed(apps: { id: string; subscribed_fields?: string[] }[], appId: string): boolean {
  return apps.some(a => a.id === appId && a.subscribed_fields?.includes("leadgen"));
}
export async function discoverMetaPages(
  mappings: MetaMappings, env: Env = process.env, fetcher: MetaFetch = fetch, subscribe = false,
): Promise<MetaPage[]> {
  const config = metaConfig(env);
  if (!config.defaultToken || !/^\d+$/.test(env.META_APP_ID ?? "")) throw new MetaAdminError("META_PAGE_ACCESS_TOKEN and META_APP_ID are required");
  const deadline = Date.now() + 45_000;
  const tokenEnv = { ...env, SESSION_SECRET: env.SESSION_SECRET ?? process.env.SESSION_SECRET };
  const pages = await refreshMetaPageTokens(config, tokenEnv, fetcher, deadline);
  const output: MetaPage[] = [];
  for (const page of pages) {
    if (!validMetaId(page.id)) throw new MetaAdminError("Meta returned an invalid Page ID");
    const item: MetaPage = { id: page.id, name: page.name, appId: env.META_APP_ID!, appPresent: null, subscribed: null, forms: [], error: null };
    try {
      if (Date.now() >= deadline) throw new MetaAdminError("Meta discovery time limit reached; remaining Pages not checked");
      const token = await resolveMetaPageToken(config, page.id, tokenEnv, fetcher, false);
      if (!token) throw new MetaAdminError("Meta did not return a Page access token; check Page tasks and permissions");
      let apps = await graphList<{ id: string; subscribed_fields?: string[] }>(`${page.id}/subscribed_apps`, token, fetcher, deadline);
      if (subscribe && !isLeadgenSubscribed(apps, env.META_APP_ID!)) {
        const result = await metaGraph<{ success?: boolean }>(`${page.id}/subscribed_apps`, token, { method: "POST" }, fetcher);
        if (!result.success) throw new MetaAdminError("Meta did not acknowledge subscription");
        apps = await graphList<{ id: string; subscribed_fields?: string[] }>(`${page.id}/subscribed_apps`, token, fetcher, deadline);
      }
      item.subscribed = isLeadgenSubscribed(apps, env.META_APP_ID!);
      item.appPresent = apps.some(app => app.id === env.META_APP_ID);
      if (subscribe && !item.subscribed) item.error = "Subscription was not confirmed on read-back";
      const forms = await graphList<{ id: string; name: string; status?: string; questions?: MetaForm["questions"] }>(`${page.id}/leadgen_forms`, token, fetcher, deadline);
      item.forms = forms.map(form => {
        const resolved = resolveMetaBrand({ id: "", form_id: form.id }, { pageId: page.id }, form.name, mappings);
        return { id: form.id, name: form.name, status: form.status ?? "unknown", questions: (form.questions ?? []).map(q => ({ key: q.key, label: q.label, type: q.type })), brand: resolved.brand, resolvedBy: resolved.resolvedBy };
      });
    } catch (error) { item.error = error instanceof MetaAdminError ? error.category : "Meta Page inspection failed"; }
    output.push(item);
  }
  return output;
}
/** Detailed errors are administrator-only, credential-redacted and text-rendered. */
export function safeMetaError(value: string | null): string | null {
  return metaDiagnostic(value);
}
export async function loadMetaReceipts(): Promise<MetaReceipt[]> {
  const rows = await query<MetaReceipt>(
    `SELECT e.leadgen_id,e.page_id,e.form_id,e.state,e.attempts,COALESCE(e.last_error,d.last_integration_error) AS last_error,
       e.received_at,e.updated_at,e.lease_until,c.hubspot_contact_id,d.hubspot_deal_id,
       d.integration_sync_status AS sync_status,
       CASE WHEN d.integration_sync_status IN ('pending','failed') THEN r.next_attempt_at ELSE NULL END AS retry_at
     FROM meta_leadgen_event e LEFT JOIN deal d ON d.id=e.deal_id
     LEFT JOIN contact c ON c.id=d.contact_id LEFT JOIN lead_hubspot_retry r ON r.deal_id=d.id
     ORDER BY e.received_at DESC LIMIT 20`,
  );
  return rows.map(row => ({ ...row, last_error: safeMetaError(row.last_error) }));
}
export async function runMetaHandshakeSelfTest(origin: string, env: Env = process.env, fetcher: MetaFetch = fetch): Promise<boolean> {
  if (!env.META_LEADGEN_VERIFY_TOKEN) return false;
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return false;
  const url = new URL("/api/meta/leadgen", base.origin);
  url.search = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": env.META_LEADGEN_VERIFY_TOKEN, "hub.challenge": "p5-admin-self-test" }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
    return response.status === 200 && await response.text() === "p5-admin-self-test";
  } catch { return false; }
}
export async function metaAdminSnapshot() {
  const mappings = await loadMetaMappings();
  return { readiness: metaReadiness(), mappings: { pages: mappings.pages, forms: { ...META_LEAD_FORMS, ...mappings.forms } }, receipts: await loadMetaReceipts() };
}
