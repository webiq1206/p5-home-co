# Estimator abandonment recovery and partial-completion tracking

Shipped 2026-09-08 on p5homeco.com's quote form (app/quote) - the four brand sites run the same policy over Drizzle.

## What the visitor sees
When a visitor who has made real progress in an estimator or lead form is about to leave, one prompt offers help: Call, Text, a callback request (phone number, optional name), or "No thanks". Triggers, in priority order:

1. Clicking an in-site link outside the wizard (the navigation is paused, and resumes on "No thanks, continue").
2. Desktop exit intent (pointer leaves through the top edge, fine pointers only).
3. 90 seconds of inactivity while the page is visible.

Never on tab close or browser shutdown (browsers do not allow a custom prompt there). Shown at most once per browser session; dismissal is remembered. Escape and the backdrop dismiss it. Focus is managed by the dialog primitive.

## Engagement threshold
A session counts as engaged once the visitor has completed a step (step index >= 1 or a completed step is recorded) or has spent 20 seconds inside the flow. Below that, nothing is emailed and the row expires silently after 7 days.

## Partial-completion emails
`app/lib/leads/estimatorSessions.ts` keeps one row per session in `estimator_sessions` (`migrations/013_estimator_sessions.sql`, applied at boot; also created on first use). A sweep marks a session abandoned after **30 minutes** without a progress report and sends **one** summary to the site's admin recipients (active `app_user` rows with the manager or administrator role, like lead alerts). The claim is an atomic conditional UPDATE, so concurrent workers cannot both send; a failed send records the error and is retried on the next pass, up to 5 attempts.

The sweep runs two ways: opportunistically from the progress endpoint (at most every 5 minutes per instance) and from the five-minute watchdog job (`runWatchdog`), so no extra schedule is needed; `POST /api/internal/abandonment-sweep` with `Authorization: Bearer $WATCHDOG_SECRET` runs it on demand.

A completed submission (`markEstimatorCompleted`) sets the session to `completed`, which the sweep never emails. A completion after the summary was sent sets `recovered`.

Callback requests (`POST /api/recovery/callback`) are stored on the session and emailed immediately, once; the session is then excluded from the abandonment sweep so nobody gets two emails about one visitor.

## Data policy
- Session id: random, per tab (`sessionStorage`), never linked to cookies or accounts.
- Stored: site, flow, page path (no query string), device category, timestamps, step positions, completion percent, time in flow, allow-listed selections (keys matching `^[a-z][a-z0-9_]*$`, never anything containing name/email/phone/address), validation error codes, exit method (or `unknown`), prompt interactions.
- Contact details only from an explicit callback request. Typed-but-unsubmitted contact fields are never captured.
- Retention: rows are deleted after 90 days.
- Emails state plainly when no contact information exists ("anonymous partial completion") and that a call/text click shows intent, not a conversation.

## Integration
`app/quote/QuoteForm.tsx` reports progress once the form is started and renders `AbandonmentPrompt`; on a 201 it calls `markEstimatorCompleted("quote")`. Analytics event: `estimator_recovery_prompt` with `action` in shown / call / text / callback_requested / stay / continue_leaving.
