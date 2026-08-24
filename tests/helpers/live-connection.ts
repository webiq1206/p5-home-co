/**
 * Getting a live QuickBooks credential for the verification suites (S220).
 *
 * Two ways in, deliberately in this order:
 *
 *   1. The app's OWN stored connection. When these tests run where the app
 *      runs - the Replit shell, say - the credentials are already there,
 *      encrypted at rest, and refreshed by the same code the app uses. Nothing
 *      has to be copied, pasted, exported or remembered.
 *
 *   2. An explicit QBO_LIVE_ACCESS_TOKEN, for running from somewhere the app's
 *      database is not reachable.
 *
 * The first is strongly preferred, and not only for convenience. A token
 * pasted into a shell profile outlives the session, gets shoulder-surfed, ends
 * up in shell history and eventually in a backup. A token the code fetches and
 * never writes down cannot do any of that.
 *
 * The database import is dynamic so that this module can be loaded - and the
 * guard tests around it can run - on a machine with no pg driver configured
 * and no database in sight.
 */

export type LiveConnection = {
  accessToken: string;
  realmId: string;
  /** Where the credential came from, so the test output can say. */
  source: "app-connection" | "environment";
};

/**
 * Resolve a credential, or null when none is available.
 *
 * Never throws for "not configured" - that is a skip, not a failure. It does
 * throw when a connection exists but is unusable, because a refresh token that
 * expired is a real problem worth surfacing rather than silently skipping.
 */
export async function resolveLiveConnection(): Promise<LiveConnection | null> {
  const explicitToken = process.env.QBO_LIVE_ACCESS_TOKEN?.trim();
  const explicitRealm = process.env.QBO_LIVE_REALM_ID?.trim();

  // The app's own connection first.
  if (process.env.DATABASE_URL && process.env.QBO_TOKEN_KEY) {
    try {
      const { getFreshAccessToken } = await import("../../app/lib/finance/qbo/oauth.ts");
      const conn = await getFreshAccessToken();
      if (conn?.accessToken && conn.realmId) {
        return {
          accessToken: conn.accessToken,
          realmId: conn.realmId,
          source: "app-connection",
        };
      }
    } catch (error) {
      // An expired refresh token is worth saying out loud rather than falling
      // through to "not configured", which would read as nothing being wrong.
      const message = (error as Error).message;
      if (/expired/i.test(message)) throw error;
      // Anything else (no database reachable, driver missing) falls through to
      // the environment, which is the whole point of having two paths.
    }
  }

  if (explicitToken && explicitRealm) {
    return { accessToken: explicitToken, realmId: explicitRealm, source: "environment" };
  }

  return null;
}

/** Close the pool the dynamic import may have opened, so the runner can exit. */
export async function closeLiveConnection(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { getPool } = await import("../../app/lib/db.ts");
    await getPool().end();
  } catch {
    // Nothing was opened, or it is already closed. Either is fine.
  }
}
