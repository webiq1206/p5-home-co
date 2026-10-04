# Bounded P5 QA provider acceptance

This path is for fresh, explicitly labelled P5 QA drafts only. Public draft requests cannot enable it. Create the draft and `qa-bounded-provider-v1` work marker atomically with the server-owned `saveDraft(..., 'bounded-paid')` function. Delivery contacts remain empty and immutable; review notifications are denied. Existing customers retain their ordinary transport and pricing behavior.

The document service owns a single durable ledger for website analysis, clarifications, pricing, shortlist, qualification, benchmarks and document Reader requests. Existing tenant HMAC authentication signs broker requests. Website provider credentials are not forwarded; the service uses its existing resident Anthropic configuration. Missing project bindings, changed identities, unsupported models or options, and absent permits fail closed.

Operator sequence, using the existing authorized server/database environment:

1. Inspect existing `p5ds_qa_runs`, projects, intents and calls. Never delete/reset them. `QaBudget.provision([{tenant:'p5homeco.com', project:'qa-paid-<draft UUID>', lot29:true|false}])` adds immutable project bindings to the fixed acceptance run, not new headroom.
2. Run the real QA action once without permission. It retains the normalized exact request in `p5ds_qa_intents` and stops before provider dispatch. Inspect original source identity, images/text, prompt/schema, requested model/output and reservation.
3. Only after that native review, call the server-owned `QaBudget.permit(requestHash, uniqueSlot, substantiveReviewNote)` for that exact retained intent. There is no provisioning or permit HTTP endpoint and no automatic permit issuer.
4. Resume the action once. Only the matching intent can consume its one-use permit. Inspect the retained complete response, returned model, usage and settlement before reviewing another request. A settled identical request replays its saved response without a new charge.
5. Any unknown request remains fully reserved and freezes this acceptance run. A timeout, process restart, old lease, changed prompt or ordinary retry cannot release that liability. Do not repair unknown accounting by deleting records or substituting assumed zero usage.

Fixed accounting: $3.25 historical, including $0.39 unknown held; $2 fresh allowance; combined at most $5.25 within the existing $12 umbrella. Historical Lot29 allocation $1 plus the entire fresh allowance cannot exceed its $3 ceiling. Each request reserves at most $0.45. One permitted/in-flight request per run. No automatic paid retry. Haiku4.5 snapshot only, standard tier, no cache writes or paid server tools. The conservative full 200K input-context bound plus the requested output maximum uses $1/$5 per million tokens. Actual verified usage reduces only that request's reservation; a missing/invalid receipt never frees it.

The earlier denied transfer of private guard authority/review/carryforward artifacts is separate and remains blocked. This implementation does not transfer, reinterpret or recreate those artifacts.

Offline evidence: `services/document-service/test/qa-budget.test.mjs` exercises real SQL reservations, concurrency, restart, caps, unknown holds and receipts. `scripts/test-p5-qa-paid.mts` exercises genuine site work entry points, signed HTTP handler, ledger, Reader, shortlist and page evidence using fake provider responses and no real sockets. These checks establish control behavior, not successful real document semantics or market pricing accuracy.
