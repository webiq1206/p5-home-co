/** Google Ads "P5 Estimator Completed". A non-accepted finish sends only this. */
export const ESTIMATOR_CONVERSION_SEND_TO = 'AW-18354188204/cEzmCPOagKAdEKzf-q9E';

/** Labels for one estimator finish.
 * Accepted means the form label as well as the estimator label.
 * A duplicate replay is not accepted, so only the estimator label remains.
 * A 409 throws before the estimator asks for these labels. */
export function finishConversionLabels(accepted: boolean): Array<'estimator' | 'form'> {
  return accepted ? ['estimator', 'form'] : ['estimator'];
}

/** Estimator and intake keys send cEzm, plus the form label only when the finish was accepted.
 * Every other key is an ordinary lead and sends the form label only. */
export function finishConversionSendTargets(dedupeKey: string | undefined, accepted: boolean, formSendTo: string): string[] {
  if (dedupeKey && (dedupeKey.startsWith('intake:') || dedupeKey.startsWith('estimator:'))) {
    return accepted ? [ESTIMATOR_CONVERSION_SEND_TO, formSendTo] : [ESTIMATOR_CONVERSION_SEND_TO];
  }
  return [formSendTo];
}
