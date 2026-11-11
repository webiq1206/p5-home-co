/** Bounded Graph control plane. Tokens never occur in URLs, results or errors. */
import { query } from "../db.ts";
import { getSmtpConfig } from "../notifications/smtp-config.ts";
import { metaConfig, pageToken, GRAPH_VERSION, META_LEAD_FORMS, resolveMetaBrand } from "./meta-leadgen.ts";
import { loadMetaMappings, validMetaId, type MetaMappings } from "./meta-settings.ts";

type Env = Record<string, string | undefined>;
export type MetaFetch = typeof fetch;
export type MetaForm = { id: string; name: string; status: string; questions: { key?: string; label?: string; type?: string }[]; brand: string; resolvedBy: string };
export type MetaPage = { id: string; name: string; subscribed: boolean | null; error: string | null; forms: MetaForm[] };
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
export class MetaAdminError extends Error {
  readonly category: string;
  constructor(category: string) { super(category); this.category = category; }
}
function safePath(path: string): boolean {
  return /^(me\/accounts|\d{1,40}\/(subscribed_apps|leadgen_forms))$/.test(path);
}
export async function metaGraph<T>(
  path: string, token: string, options: { method?: "GET" | "POST"; after?: string } = {},
  fetcher: MetaFetch = fetch,
): Promise<T> {
  if (!safePath(path) || !token) throw new MetaAdminError("Meta configuration missing or invalid");
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  if (options.method !== "POST") {
    url.searchParams.set("limit", "100");
    url.searchParams.set("fields", path === "me/accounts" ? "id,name" : path.endsWith("subscribed_apps") ? "id,name,subscribed_fields" : "id,name,status,questions");
    if (options.after) url.searchParams.set("after", options.after);
  }
  try {
    const response = await fetcher(url, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(options.method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: options.method === "POST" ? "subscribed_fields=leadgen" : undefined,
      signal: AbortSignal.timeout(5000), cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new MetaAdminError(`Meta HTTP ${response.status}`);
    const result = await response.json();
    if (result?.error) throw new MetaAdminError("Meta returned an API error");
    return result as T;
  } catch (error) {
    if (error instanceof MetaAdminError) throw error;
    throw new MetaAdminError("Meta request failed or timed out");
  }
}
async function graphList<T>(path: string, token: string, fetcher: MetaFetch, deadline: number): Promise<T[]> {
  const entries: T[] = [];
  let after: string | undefined;
  for (let n = 0; n < 10; n++) {
    if (Date.now() >= deadline) throw new MetaAdminError("Meta discovery time limit reached; list incomplete");
    const result = await metaGraph<{ data: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(path, token, { after }, fetcher);
    if (!Array.isArray(result.data)) throw new MetaAdminError("Meta returned an invalid list");
    entries.push(...result.data);
    if (!result.paging?.next) return entries;
    // Never follow provider-supplied URLs (they may contain a token).
    after = result.paging.cursors?.after;
    if (!after) throw new MetaAdminError("Meta pagination cursor missing; list incomplete");
  }
  throw new MetaAdminError("Meta pagination limit reached; list incomplete");
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
  const pages = await graphList<{ id: string; name: string }>("me/accounts", config.defaultToken, fetcher, deadline);
  const output: MetaPage[] = [];
  for (const page of pages) {
    if (!validMetaId(page.id)) throw new MetaAdminError("Meta returned an invalid Page ID");
    const item: MetaPage = { id: page.id, name: page.name, subscribed: null, forms: [], error: null };
    try {
      if (Date.now() >= deadline) throw new MetaAdminError("Meta discovery time limit reached; remaining Pages not checked");
      const token = pageToken(config, page.id);
      let apps = await graphList<{ id: string; subscribed_fields?: string[] }>(`${page.id}/subscribed_apps`, token, fetcher, deadline);
      if (subscribe && !isLeadgenSubscribed(apps, env.META_APP_ID!)) {
        const result = await metaGraph<{ success?: boolean }>(`${page.id}/subscribed_apps`, token, { method: "POST" }, fetcher);
        if (!result.success) throw new MetaAdminError("Meta did not acknowledge subscription");
        apps = await graphList<{ id: string; subscribed_fields?: string[] }>(`${page.id}/subscribed_apps`, token, fetcher, deadline);
      }
      item.subscribed = isLeadgenSubscribed(apps, env.META_APP_ID!);
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
/** Allowlisted error category only; stored provider errors can contain private data. */
export function safeMetaError(value: string | null): string | null {
  if (!value) return null;
  const status = value.match(/\b(?:400|401|403|404|408|409|429|500|502|503|504)\b/);
  return status ? `HTTP ${status[0]} — review server integration diagnostics` :
    ["meta-processing-error", "no-contact", "missing-token"].includes(value) ? value : "Processing failed; inspect restricted server diagnostics";
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
