/** One deadline follows a processing attempt through every stage and retry.
 * Expiry is a recoverable pause, never permission to return an unchecked price. */
export const PROCESSING_LIMIT_MS = 60_000;
export const SERVER_BUDGET_MS = 54_000;
export const CLIENT_BUDGET_MS = 58_000;
/** A background operation (document reading, pricing) is driven by polling
 * requests; the browser waits on it far longer than one request budget and
 * shows saved progress the whole time. */
export const CLIENT_BACKGROUND_BUDGET_MS = Number(process.env.NEXT_PUBLIC_P5_CLIENT_BACKGROUND_BUDGET_MS||15*60_000);
/** Durable background work may outlive one browser wait. It continues in the
 * queue while the visitor is shown honest progress and a way to keep going. */
export const BACKGROUND_JOB_LIMIT_MS = 20 * 60_000;
/** One pricing pass may finish an in-flight provider stage. Stages are saved
 * individually, so a pass that ends between stages loses nothing; a pass that
 * aborted a long stage every 54 seconds could never complete it. */
export const PRICING_PASS_MS = 240_000;
/** One document-reading pass. A provider read of a dense page is allowed to
 * finish inside the pass; passes that cut reads off at 54 s counted every
 * cut-off as a failed attempt and declared readable pages unreadable. */
export const ANALYSIS_PASS_MS = Number(process.env.P5_ANALYSIS_PASS_MS||240_000);
/** Longest one provider read of one document section may run. */
export const READ_ALLOWANCE_MS = Number(process.env.P5_READ_ALLOWANCE_MS||120_000);
/** A new section read is only started when at least this much of the pass remains. */
export const READ_START_MARGIN_MS = Number(process.env.P5_READ_START_MARGIN_MS||75_000);
export const PROCESSING_PAUSED = 'We could not verify everything within 60 seconds. Your completed work is saved. Resume the check to continue where it stopped.';

export class ProcessingDeadlineError extends Error {
  constructor() { super(PROCESSING_PAUSED); this.name = 'ProcessingDeadlineError'; }
}
/** Deadline errors can cross a dynamically imported chunk, where instanceof
 * sees a different class copy; match on the name as well. */
export function isProcessingDeadline(error: unknown): error is ProcessingDeadlineError {
  return error instanceof ProcessingDeadlineError || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ProcessingDeadlineError');
}
export function remainingBudget(deadline: number, now = Date.now()): number {
  const remaining = Math.floor(deadline - now);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new ProcessingDeadlineError();
  return remaining;
}
export async function withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingBudget(deadline);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProcessingDeadlineError()), remaining); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
/** Read the response body under the same deadline as its headers. */
export async function fetchWithinDeadline(request: typeof fetch, input: Parameters<typeof fetch>[0], init: RequestInit, deadline: number): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new ProcessingDeadlineError()), remainingBudget(deadline));
  try {
    return await withinDeadline(async () => {
      const response = await request(input, { ...init, signal: controller.signal });
      const bytes = await response.arrayBuffer();
      remainingBudget(deadline);
      return new Response(bytes.byteLength ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }, deadline);
  } catch (error) {
    if (Date.now() >= deadline || isProcessingDeadline(controller.signal.reason)) throw new ProcessingDeadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
