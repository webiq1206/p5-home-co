/** One deadline follows a processing attempt through every stage and retry.
 * Expiry is a recoverable pause, never permission to return an unchecked price. */
export const PROCESSING_LIMIT_MS = 60_000;
export const SERVER_BUDGET_MS = 54_000;
export const CLIENT_BUDGET_MS = 58_000;
export const PROCESSING_PAUSED = 'We could not verify everything within 60 seconds. Your completed work is saved. Resume the check to continue where it stopped.';

export class ProcessingDeadlineError extends Error {
  constructor() { super(PROCESSING_PAUSED); this.name = 'ProcessingDeadlineError'; }
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
    if (Date.now() >= deadline || controller.signal.reason instanceof ProcessingDeadlineError) throw new ProcessingDeadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
