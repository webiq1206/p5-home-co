/**
 * Intuit OAuth2 for QuickBooks Online (S201).
 *
 * Configuration (environment):
 *   QBO_CLIENT_ID / QBO_CLIENT_SECRET  - from the Intuit developer app
 *   QBO_ENV                            - 'production' (default) or 'sandbox'
 *   QBO_TOKEN_KEY                      - see crypto.ts
 *
 * Tokens are stored AES-encrypted in qbo_connection (single row). Access
 * tokens live ~1 hour and refresh tokens ~100 days; getFreshAccessToken
 * refreshes transparently and persists the rotated refresh token, because
 * Intuit rotates it on every refresh and the old one dies.
 */

import { randomBytes } from "node:crypto";

import { query, queryOne } from "../../db.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";

/**
 * Endpoints come from Intuit's discovery document, which is what they ask apps
 * to do so a moved endpoint does not break every integration at once. The
 * constants below are the fallback for when discovery is unreachable - stale
 * endpoints beat no endpoints, and a connection attempt that fails because we
 * could not fetch a JSON document would be a poor trade.
 */
const DISCOVERY_URL_PRODUCTION =
  "https://developer.api.intuit.com/.well-known/openid_configuration";
const DISCOVERY_URL_SANDBOX =
  "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration";

const FALLBACK_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const FALLBACK_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

type Endpoints = { authorize: string; token: string };

/** Cached for the process lifetime; these change on the order of years. */
let discovered: Endpoints | null = null;

async function endpoints(): Promise<Endpoints> {
  if (discovered) return discovered;

  const url =
    process.env.QBO_ENV === "sandbox" ? DISCOVERY_URL_SANDBOX : DISCOVERY_URL_PRODUCTION;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const doc = (await res.json()) as {
        authorization_endpoint?: string;
        token_endpoint?: string;
      };
      if (doc.authorization_endpoint && doc.token_endpoint) {
        discovered = {
          authorize: doc.authorization_endpoint,
          token: doc.token_endpoint,
        };
        return discovered;
      }
    }
    console.warn(`[qbo-oauth] discovery returned ${res.status}; using known endpoints.`);
  } catch (error) {
    console.warn(
      `[qbo-oauth] discovery unreachable (${(error as Error).message}); using known endpoints.`,
    );
  }
  // Deliberately not cached: a transient outage should not pin the fallback
  // for the life of the process.
  return { authorize: FALLBACK_AUTH_URL, token: FALLBACK_TOKEN_URL };
}

export function isQboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}

export function qboApiHost(): string {
  return process.env.QBO_ENV === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function clientCredentials(): { id: string; secret: string } {
  const id = process.env.QBO_CLIENT_ID;
  const secret = process.env.QBO_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set.");
  }
  return { id, secret };
}

/** Build the Intuit consent URL. State is returned for cookie storage. */
export async function buildAuthorizeUrl(
  redirectUri: string,
): Promise<{ url: string; state: string }> {
  const { id } = clientCredentials();
  const { authorize } = await endpoints();
  const state = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: id,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return { url: `${authorize}?${params}`, state };
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;               // seconds
  x_refresh_token_expires_in: number;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { id, secret } = clientCredentials();
  const { token } = await endpoints();
  const res = await fetch(token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intuit token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function persistTokens(
  realmId: string,
  tokens: TokenResponse,
  connectedBy: number | null,
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO qbo_connection
       (id, realm_id, access_cipher, refresh_cipher, access_expires_at, refresh_expires_at, connected_by)
     VALUES (1, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       realm_id = EXCLUDED.realm_id,
       access_cipher = EXCLUDED.access_cipher,
       refresh_cipher = EXCLUDED.refresh_cipher,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       updated_at = now()`,
    [
      realmId,
      encryptSecret(tokens.access_token),
      encryptSecret(tokens.refresh_token),
      new Date(now + tokens.expires_in * 1000),
      new Date(now + tokens.x_refresh_token_expires_in * 1000),
      connectedBy,
    ],
  );
}

/** OAuth callback: exchange the authorization code and store the connection. */
export async function completeConnection(
  code: string,
  realmId: string,
  redirectUri: string,
  connectedBy: number | null,
): Promise<void> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
  await persistTokens(realmId, tokens, connectedBy);
}

export type QboConnection = { realmId: string; accessToken: string };

/**
 * Return a valid access token, refreshing when within 2 minutes of expiry.
 * Returns null when no connection exists - callers surface "not connected"
 * rather than crashing (integration stays 'planned'/'not_connected').
 */
export async function getFreshAccessToken(): Promise<QboConnection | null> {
  const row = await queryOne<{
    realm_id: string;
    access_cipher: string;
    refresh_cipher: string;
    access_expires_at: Date;
    refresh_expires_at: Date;
  }>("SELECT * FROM qbo_connection WHERE id = 1");
  if (!row) return null;

  if (new Date(row.refresh_expires_at).getTime() < Date.now()) {
    throw new Error(
      "QuickBooks refresh token has expired; an administrator must reconnect.",
    );
  }

  if (new Date(row.access_expires_at).getTime() > Date.now() + 120_000) {
    return { realmId: row.realm_id, accessToken: decryptSecret(row.access_cipher) };
  }

  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(row.refresh_cipher),
    }),
  );
  await persistTokens(row.realm_id, tokens, null);
  return { realmId: row.realm_id, accessToken: tokens.access_token };
}

export async function isQboConnected(): Promise<boolean> {
  const row = await queryOne<{ refresh_expires_at: Date }>(
    "SELECT refresh_expires_at FROM qbo_connection WHERE id = 1",
  );
  return Boolean(row && new Date(row.refresh_expires_at).getTime() > Date.now());
}
