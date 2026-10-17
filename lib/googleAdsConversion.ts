/** Google Ads conversions for the shared estimator.
 *
 * Finishing /estimate on p5homeco.com does not submit a lead. Public mode is
 * review, so the finish POSTs /api/p5-estimator/intake and stores a project
 * review. It does not call ingestLead or POST /api/leads/intake. The priced
 * `estimator:` path can queue CRM only when P5_CRM_DELIVERY=on, and that flag
 * is off. Keys that start with `intake:` or `estimator:` therefore fire the
 * estimator label only. Any other key is a lead conversion and fires the form
 * label only.
 */

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

function labelsFor(key: string): string[] {
  if (key.startsWith("intake:") || key.startsWith("estimator:")) return [ESTIMATOR_SEND_TO];
  return [FORM_SEND_TO];
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

export function trackGoogleAdsLeadConversion(context: { service?: string } = {}, dedupeKey?: string): boolean {
  void context;
  try {
    if (!dedupeKey || !analyticsAllowed()) return false;
    const pending = labelsFor(dedupeKey).filter((sendTo) => claim(sendTo, dedupeKey));
    if (!pending.length) return false;
    for (const sendTo of pending) void fireWhenReady(sendTo, dedupeKey);
    return true;
  } catch {
    return false;
  }
}
