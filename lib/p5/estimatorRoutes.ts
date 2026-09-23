/**
 * Which routes the estimator owns.
 *
 * The estimator is a one-page app: it carries its own brand bar, its own step progress and its own
 * exit control. Marketing navigation and a marketing footer around it are chrome stacked on top of an
 * app that already has some, and on a phone they cost about a third of the screen before any content.
 *
 * This lives in the shared engine, with the estimator, because every brand site needs the same answer
 * and each one wires its own chrome. It is a list for the same reason isPortalPath is: the footer
 * carried a private copy naming "/estimate" and "/estimate/p5-preview" but not "/estimate/scope" -
 * the one route customers actually use - so every real estimate rendered a full marketing footer
 * below it (owner report 2026-09-23, mobile).
 */
export function isEstimatorPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/estimate' || pathname.startsWith('/estimate/');
}
