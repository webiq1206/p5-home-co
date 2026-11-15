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
  });
}

export async function saveIntentFor(request) {
  try { return await request.frame().evaluate(() => window.__p5TestSaveIntent); }
  catch { return null; }
}

export async function armAnswerSaveFailure(state, page) {
  state.failNextSaveAfter = await page.evaluate(() => window.__p5TestSaveIntent?.sequence || 0);
  state.failNextSave = true;
}
