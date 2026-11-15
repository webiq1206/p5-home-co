/** Match the actual user action, never an earlier/in-flight autosave. */
export function isExplicitSaveAttempt(startedAt, intent, name, afterSequence = 0) {
  return Number.isFinite(startedAt) && Number.isFinite(intent?.at) &&
    Number.isInteger(intent?.sequence) && intent.sequence > afterSequence &&
    intent.name === name && startedAt >= intent.at;
}

export async function installSaveIntentTracking(context) {
  await context.addInitScript(() => {
    window.__p5TestSaveIntent = {sequence: 0, at: 0, name: ''};
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      const name = button?.getAttribute('aria-label');
      if (name !== 'Send message' && name !== 'Send answer') return;
      window.__p5TestSaveIntent = {sequence: window.__p5TestSaveIntent.sequence + 1, at: Date.now(), name};
    }, true);
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.origin === location.origin && url.pathname === '/api/p5-estimator/draft' && method !== 'GET') {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        // Snapshot at fetch invocation: WebKit timing is still zero while routed.
        // The synthetic route consumes this header; it never reaches a live API.
        headers.set('x-p5-test-save-action', JSON.stringify({startedAt: Date.now(), intent: {...window.__p5TestSaveIntent}}));
        return originalFetch.call(this, input, {...init, headers});
      }
      return originalFetch.call(this, input, init);
    };
  });
}

export function saveIntentFor(request) {
  try { return JSON.parse(request.headers()['x-p5-test-save-action']); }
  catch { return null; }
}

export async function armAnswerSaveFailure(state, page) {
  state.failNextSaveAfter = await page.evaluate(() => window.__p5TestSaveIntent?.sequence || 0);
  state.failNextSave = true;
}
