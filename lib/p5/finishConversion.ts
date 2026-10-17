/** Labels for one estimator finish.
 * Accepted means the form label as well as the estimator label.
 * A duplicate replay is not accepted, so only the estimator label remains.
 * A 409 throws before the estimator asks for these labels. */
export function finishConversionLabels(accepted: boolean): Array<'estimator' | 'form'> {
  return accepted ? ['estimator', 'form'] : ['estimator'];
}
