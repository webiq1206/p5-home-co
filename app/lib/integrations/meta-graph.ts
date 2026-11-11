/** Server-only Graph control plane; never expose credentials or raw envelopes. */
export const GRAPH_VERSION = "v21.0";
export type MetaFetch = typeof fetch;
export class MetaAdminError extends Error {
  readonly category: string;
  constructor(category: string) { super(category); this.category = category; }
}

function diagnostic(message: unknown, token: string): string {
  if (typeof message !== "string") return "";
  return message.split(token).join("[redacted]")
    .replace(/(?:Bearer\s+|access_token[=:]\s*)[^\s"'&,]+/gi, "[redacted]")
    .replace(/\b(?:EAA[A-Za-z0-9]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400);
}

export async function metaGraph<T>(
  path: string, token: string, options: { method?: "GET" | "POST"; after?: string } = {},
  fetcher: MetaFetch = fetch,
): Promise<T> {
  if (!/^(me\/accounts|\d{1,40}\/(subscribed_apps|leadgen_forms))$/.test(path) || !token) {
    throw new MetaAdminError("Meta configuration missing or invalid");
  }
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  if (options.method !== "POST") {
    url.searchParams.set("limit", "100");
    url.searchParams.set("fields", path === "me/accounts" ? "id,name,access_token,tasks" :
      path.endsWith("subscribed_apps") ? "id,name,subscribed_fields" : "id,name,status,questions");
    if (options.after) url.searchParams.set("after", options.after);
  }
  try {
    const response = await fetcher(url, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(options.method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: options.method === "POST" ? "subscribed_fields=leadgen" : undefined,
      signal: AbortSignal.timeout(5000), cache: "no-store", redirect: "error",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.error) {
      const code = Number.isInteger(result?.error?.code) ? ` (code ${result.error.code})` : "";
      const message = diagnostic(result?.error?.message, token);
      throw new MetaAdminError(`Meta HTTP ${response.status}${code}${message ? `: ${message}` : ""}`);
    }
    if (!result) throw new MetaAdminError("Meta returned an invalid response");
    return result as T;
  } catch (error) {
    if (error instanceof MetaAdminError) throw error;
    throw new MetaAdminError("Meta request failed or timed out");
  }
}

export async function graphList<T>(path: string, token: string, fetcher: MetaFetch, deadline: number): Promise<T[]> {
  const entries: T[] = [];
  let after: string | undefined;
  for (let n = 0; n < 10; n++) {
    if (Date.now() >= deadline) throw new MetaAdminError("Meta discovery time limit reached; list incomplete");
    const result = await metaGraph<{ data: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(path, token, { after }, fetcher);
    if (!Array.isArray(result.data)) throw new MetaAdminError("Meta returned an invalid list");
    entries.push(...result.data);
    if (!result.paging?.next) return entries;
    after = result.paging.cursors?.after;
    if (!after) throw new MetaAdminError("Meta pagination cursor missing; list incomplete");
  }
  throw new MetaAdminError("Meta pagination limit reached; list incomplete");
}
