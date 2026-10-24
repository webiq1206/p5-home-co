/** Estimator finishes emit a primary form conversion only for explicit server acceptance.
 * Session and project identity deduplication protect against repeated finish paths. */

/** Missing acceptance never implies an accepted lead. */
export const ESTIMATOR_FINISH_CREATES_ACCEPTED_LEAD = false;

const ESTIMATOR_SEND_TO = "AW-18354188204/cEzmCPOagKAdEKzf-q9E";
const FORM_SEND_TO = "AW-18354188204/LE2vCPXstO8cEKzf-q9E";
const ADS_HOST = "p5homeco.com";
const WAIT_MS = 5000;
const POLL_MS = 50;
const fired = new Set<string>();

function conversionId(sendTo: string, transactionId: string) {
  return `${sendTo}\n${transactionId}`;
}

function storageKey(sendTo: string, transactionId: string) {
  return `p5_ads_fired:${conversionId(sendTo, transactionId)}`;
}

/** Same visitor gate as googleTagBootstrap: live host, no webdriver, not the saved-QA path, and not the explicit analytics opt-out. */
function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const host = String(window.location?.hostname || "").toLowerCase();
  if (host !== ADS_HOST && host !== `www.${ADS_HOST}`) return false;
  if (window.navigator?.webdriver === true) return false;
  const path = window.location?.pathname || "";
  if (path === "/estimate/qa-saved" || path.startsWith("/estimate/qa-saved/")) return false;
  try {
    if (window.sessionStorage?.getItem("p5_analytics_disabled") === "1") return false;
  } catch {
    // The tag bootstrap still loads when storage throws.
  }
  return true;
}

/** Draft id shared by `intake:p5:<id>` and `estimator:<id>`, or the suffix of a shorter key. */
export function projectIdentity(completionKey: string): string {
  const match = /^(?:intake:|estimator:)(?:(?:p5|construction|remodeling|handyman|cabinet):)?(.+)$/i.exec(completionKey);
  return (match?.[1] || completionKey).toLowerCase();
}

export function plannedAdsConversions(completionKey: string, createsAcceptedLead: boolean): Array<{ sendTo: string; transactionId: string }> {
  if (completionKey.startsWith("intake:") || completionKey.startsWith("estimator:")) {
    const events = [{ sendTo: ESTIMATOR_SEND_TO, transactionId: completionKey }];
    if (createsAcceptedLead) events.push({ sendTo: FORM_SEND_TO, transactionId: projectIdentity(completionKey) });
    return events;
  }
  return [{ sendTo: FORM_SEND_TO, transactionId: completionKey }];
}

function claim(sendTo: string, transactionId: string): boolean {
  const id = conversionId(sendTo, transactionId);
  if (fired.has(id)) return false;
  try {
    const key = storageKey(sendTo, transactionId);
    if (window.sessionStorage?.getItem(key) === "1") {
      fired.add(id);
      return false;
    }
    window.sessionStorage?.setItem(key, "1");
  } catch {
    // In-memory dedupe still holds for this page.
  }
  fired.add(id);
  return true;
}

async function fireWhenReady(sendTo: string, transactionId: string) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const gtag = window.gtag;
      if (typeof gtag === "function") {
        gtag("event", "conversion", { send_to: sendTo, transaction_id: transactionId });
        return;
      }
    } catch {
      return;
    }
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Events still owed for this completion. Records the claim, so a later call does not repeat one. */
export function adsConversionsToSend(completionKey: string, createsAcceptedLead: boolean): Array<{ sendTo: string; transactionId: string }> {
  return plannedAdsConversions(completionKey, createsAcceptedLead).filter((event) => claim(event.sendTo, event.transactionId));
}

export function trackGoogleAdsLeadConversion(context: { service?: string } = {}, dedupeKey?: string, acceptance?: { accepted?: boolean }): boolean {
  void context;
  try {
    if (!dedupeKey || !analyticsAllowed()) return false;
    const createsLead = dedupeKey.startsWith("intake:") || dedupeKey.startsWith("estimator:")
      ? acceptance?.accepted === true
      : true;
    const pending = adsConversionsToSend(dedupeKey, createsLead);
    if (!pending.length) return false;
    for (const event of pending) void fireWhenReady(event.sendTo, event.transactionId);
    return true;
  } catch {
    return false;
  }
}

export { ESTIMATOR_CONVERSION_SEND_TO } from "./p5/finishConversion.ts";
