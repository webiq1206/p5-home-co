/** Page credentials are private: encrypted at rest, never returned to admin clients. */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { query } from "../db.ts";
import { graphList, MetaAdminError, type MetaFetch } from "./meta-graph.ts";
import type { MetaConfig } from "./meta-leadgen.ts";

type Env = Record<string, string | undefined>;
type Account = { id: string; name: string; access_token?: string; tasks?: string[] };
const TTL_MS = 60 * 60 * 1000;
const MEMORY_TTL_MS = 5 * 60 * 1000;
const memory = new Map<string, { token: string; expires: number }>();
const pending = new Map<string, Promise<Account[]>>();
function context(config: MetaConfig, env: Env): string {
  return createHash("sha256").update(`${env.META_APP_ID ?? ""}:${config.defaultToken}`).digest("hex");
}
function encryptionKey(env: Env): Buffer {
  if (!env.SESSION_SECRET) throw new MetaAdminError("SESSION_SECRET is required for encrypted Meta Page token storage");
  return Buffer.from(hkdfSync("sha256", env.SESSION_SECRET, "p5-meta-page-tokens", "aes-256-gcm-v1", 32));
}
function seal(token: string, key: Buffer, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
}
function open(value: string, key: Buffer, binding: string): string {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}

/** Every explicit discovery refreshes credentials, even with a warm cache. */
export async function refreshMetaPageTokens(
  config: MetaConfig, env: Env, fetcher: MetaFetch = fetch, deadline = Date.now() + 45_000,
): Promise<{ id: string; name: string }[]> {
  const scope = context(config, env);
  let task = pending.get(scope);
  if (!task) {
    task = (async () => {
      const key = encryptionKey(env);
      const accounts = await graphList<Account>("me/accounts", config.defaultToken, fetcher, deadline);
      const expires = Date.now() + TTL_MS;
      // Persist first: a database outage cannot silently leave only process-local credentials.
      for (const page of accounts) {
        if (!/^\d{1,40}$/.test(page.id)) throw new MetaAdminError("Meta returned an invalid Page ID");
        if (!page.access_token?.trim()) continue;
        const binding = `${scope}:${page.id}`;
        try {
          await query(`INSERT INTO meta_page_token (token_context,page_id,token_ciphertext,expires_at)
            VALUES ($1,$2,$3,$4) ON CONFLICT (token_context,page_id)
            DO UPDATE SET token_ciphertext=EXCLUDED.token_ciphertext,expires_at=EXCLUDED.expires_at,updated_at=now()`,
          [scope, page.id, seal(page.access_token, key, binding), new Date(expires)]);
        } catch { throw new MetaAdminError("Meta Page token cache unavailable; check database migration 026"); }
      }
      // A fresh complete discovery supersedes prior in-memory results, including removed Pages.
      for (const id of memory.keys()) if (id.startsWith(`${scope}:`)) memory.delete(id);
      const ids = accounts.filter(p => p.access_token?.trim()).map(p => p.id);
      try {
        await query("DELETE FROM meta_page_token WHERE token_context=$1 AND NOT (page_id = ANY($2::text[]))", [scope, ids]);
      } catch { throw new MetaAdminError("Meta Page token cache unavailable; check database migration 026"); }
      for (const page of accounts) if (page.access_token?.trim()) memory.set(`${scope}:${page.id}`, { token: page.access_token, expires: Date.now() + MEMORY_TTL_MS });
      return accounts;
    })();
    pending.set(scope, task);
  }
  try { return (await task).map(p => ({ id: p.id, name: p.name })); }
  finally { if (pending.get(scope) === task) pending.delete(scope); }
}

/** Overrides > unexpired memory > encrypted durable cache > one account discovery. Never system-token fallback. */
export async function resolveMetaPageToken(config: MetaConfig, pageId: string | null, env: Env, fetcher: MetaFetch = fetch, refresh = true): Promise<string> {
  if (!pageId || !/^\d{1,40}$/.test(pageId)) return "";
  if (config.pageTokens[pageId]) return config.pageTokens[pageId];
  if (!config.defaultToken) return "";
  const scope = context(config, env), binding = `${scope}:${pageId}`;
  const cached = memory.get(binding);
  if (cached && cached.expires > Date.now()) return cached.token;
  memory.delete(binding);
  let rows: { token_ciphertext: string; expires_at: string }[];
  try {
    rows = await query("SELECT token_ciphertext,expires_at FROM meta_page_token WHERE token_context=$1 AND page_id=$2 AND expires_at > now()", [scope, pageId]);
  } catch { throw new MetaAdminError("Meta Page token cache unavailable; check database migration 026"); }
  if (rows[0]) {
    try {
      const token = open(rows[0].token_ciphertext, encryptionKey(env), binding);
      memory.set(binding, { token, expires: Math.min(new Date(rows[0].expires_at).getTime(), Date.now() + MEMORY_TTL_MS) });
      return token;
    } catch { /* Rotated encryption key or corrupt ciphertext: resolve again, never send ciphertext. */ }
  }
  if (!refresh) return "";
  await refreshMetaPageTokens(config, env, fetcher);
  return memory.get(binding)?.token ?? "";
}
