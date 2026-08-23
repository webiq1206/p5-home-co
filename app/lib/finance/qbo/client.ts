/**
 * Minimal QuickBooks Online v3 API client (S201).
 *
 * Read-heavy by design: the sync engine pulls; P5 Admin never posts ledger
 * entries (S212-41). Retries are safe because every caller is a query or an
 * idempotent upsert into our own read model. Rate limits (HTTP 429) and
 * transient 5xx back off exponentially; auth failures surface immediately so
 * the connection state can be shown honestly (S176: no silent failures).
 */

import { getFreshAccessToken, qboApiHost } from "./oauth.ts";

const MINOR_VERSION = "75";
const MAX_ATTEMPTS = 4;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function qboRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const conn = await getFreshAccessToken();
  if (!conn) throw new Error("QuickBooks is not connected.");

  const url = `${qboApiHost()}/v3/company/${conn.realmId}${path}${
    path.includes("?") ? "&" : "?"
  }minorversion=${MINOR_VERSION}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (res.ok) return (await res.json()) as T;

    const body = await res.text();
    // Intuit stamps every response with a transaction id. It is the handle
    // their support team asks for first, and it is worthless if we only learn
    // of a failure from a stack trace that never captured it.
    const tid = res.headers.get("intuit_tid") ?? res.headers.get("intuit-tid");
    const trace = tid ? ` [intuit_tid ${tid}]` : "";

    // 429 and 5xx are retryable; anything else is a real error to surface.
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`QBO ${res.status}${trace}: ${body.slice(0, 200)}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new Error(`QBO ${res.status} on ${path}${trace}: ${body.slice(0, 500)}`);
  }
  throw lastError ?? new Error("QBO request failed.");
}

/**
 * Run a QBO SQL-ish query, paging until exhausted. QBO caps page size at
 * 1000; STARTPOSITION pagination is the documented pattern.
 */
export async function qboQueryAll<T>(
  entity: string,
  where: string = "",
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  for (let start = 1; ; start += pageSize) {
    const sql = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await qboRequest<{
      QueryResponse: Record<string, unknown> & { maxResults?: number };
    }>(`/query?query=${encodeURIComponent(sql)}`);
    const rows = (data.QueryResponse[entity] as T[] | undefined) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
