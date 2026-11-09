/**
 * The one HubSpot portal this hub may write to.
 *
 * Everything P5 sends belongs in the hello@p5homeco.com account: portal
 * 247066159 (app-na2), owner 97300513. The same login family also reaches the
 * Timber and Love portal (247282537), which must never receive a P5 record.
 * A token pasted from the wrong portal would otherwise work perfectly and file
 * every lead in the wrong CRM, so the token's portal is checked once (the
 * account-info endpoint), cached, and every HubSpot request refuses to run
 * until it matches. A refusal is retryable: the deal stays pending or failed
 * and the watchdog tries again, so fixing the token heals the backlog.
 */

export const P5_HUBSPOT_PORTAL_ID = 247066159;
/** Never used. Named so a review can see it is refused on purpose. */
export const FORBIDDEN_HUBSPOT_PORTAL_IDS: readonly number[] = [247282537];

const VERIFIED_TTL_MS = 6 * 60 * 60 * 1000;
const REFUSED_TTL_MS = 10 * 60 * 1000;

export class HubSpotPortalError extends Error {
  readonly retryable = true;
  readonly httpStatus = 0;
  constructor(message: string) {
    super(message);
    this.name = "HubSpotPortalError";
  }
}

type Verdict = { token: string; ok: boolean; message: string; until: number };
let cached: Verdict | null = null;
let inflight: Promise<Verdict> | null = null;

/** Tests reset the cache between cases. */
export function resetHubSpotPortalCheck(): void {
  cached = null;
  inflight = null;
}

async function check(token: string): Promise<Verdict> {
  let response: Response;
  try {
    response = await fetch("https://api.hubapi.com/account-info/v3/details", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // A network failure proves nothing either way; not cached.
    throw new HubSpotPortalError("HubSpot portal check could not reach HubSpot; nothing was written.");
  }
  if (!response.ok) {
    return { token, ok: false, until: Date.now() + REFUSED_TTL_MS,
      message: `HubSpot portal check failed (HTTP ${response.status}); nothing was written. The token needs account-info access.` };
  }
  const body = (await response.json().catch(() => ({}))) as { portalId?: number | string };
  const portal = Number(body.portalId);
  if (portal === P5_HUBSPOT_PORTAL_ID) return { token, ok: true, message: "", until: Date.now() + VERIFIED_TTL_MS };
  const which = FORBIDDEN_HUBSPOT_PORTAL_IDS.includes(portal) ? " (the Timber and Love portal, never used by P5)" : "";
  return { token, ok: false, until: Date.now() + REFUSED_TTL_MS,
    message: `HUBSPOT_TOKEN belongs to portal ${Number.isFinite(portal) ? portal : "unknown"}${which}, not P5 portal ${P5_HUBSPOT_PORTAL_ID}; nothing was written.` };
}

/** Resolves when the token is P5's portal; throws HubSpotPortalError otherwise. */
export async function ensureP5HubSpotPortal(token: string): Promise<void> {
  if (!cached || cached.token !== token || cached.until < Date.now()) {
    inflight ??= check(token).finally(() => { inflight = null; });
    const verdict = await inflight;
    cached = verdict;
    if (!verdict.ok) console.error(`[hubspot] ${verdict.message}`);
  }
  if (!cached.ok) throw new HubSpotPortalError(cached.message);
}
