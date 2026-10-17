import {ESTIMATOR_CONVERSION_SEND_TO, finishConversionSendTargets} from './p5/finishConversion.ts';

const FORM_SEND_TO = 'AW-18354188204/LE2vCPXstO8cEKzf-q9E';
const fired = new Set<string>();

/** Same visitor gate as the tag bootstrap. */
function analyticsAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const host = String(window.location?.hostname || '').toLowerCase();
  if (host !== 'p5homeco.com' && host !== 'www.p5homeco.com') return false;
  if (window.navigator?.webdriver === true) return false;
  const path = window.location?.pathname || '';
  if (path === '/estimate/qa-saved' || path.startsWith('/estimate/qa-saved/')) return false;
  try {
    if (window.sessionStorage?.getItem('p5_analytics_disabled') === '1') return false;
  } catch { /* The tag still loads when storage throws. */ }
  return true;
}

/** The shared estimator calls this after an intake confirm or an estimate submit.
 * Intake passes `{accepted: receipt.accepted === true}`. Submit passes
 * `{accepted: data.accepted === true}`. A replay passes accepted false, so only
 * cEzm is sent. A non-OK response, including 409, throws before this is called. */
export function trackGoogleAdsLeadConversion(context:{service?:string}={},dedupeKey?:string,acceptance?:{accepted?:boolean}):boolean{
  void context;
  try {
    if (!dedupeKey || !analyticsAllowed()) return false;
    const targets = finishConversionSendTargets(dedupeKey, acceptance?.accepted === true, FORM_SEND_TO);
    const gtag = window.gtag;
    if (typeof gtag !== 'function') return false;
    let sent = false;
    for (const sendTo of targets) {
      const id = `${sendTo}\n${dedupeKey}`;
      if (fired.has(id)) continue;
      fired.add(id);
      gtag('event', 'conversion', {send_to: sendTo, transaction_id: dedupeKey});
      sent = true;
    }
    return sent;
  } catch {
    return false;
  }
}

export {ESTIMATOR_CONVERSION_SEND_TO};
