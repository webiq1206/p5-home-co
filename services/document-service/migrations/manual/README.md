# Restricted QA research: source only

`20261006-restricted-research.sql` is an explicit manual migration. Startup,
`documentSchemaStatements`, HTTP routes and workers neither load nor apply it.
Do not apply it as part of publishing the website or service. It creates no run,
binding, budget or permit, and does not change the original allowance constraint.
Migration017 remains deferred.

`src/restricted-research.mjs` is a dormant operator-side component. It defaults
to disabled; no environment variable, HTTP endpoint, UI or production caller
enables it. Ordinary QA admission and customer research behavior are unchanged.
Publishing this source alone cannot authorize a research call.

## Admission prerequisites

Activation and a production adapter require separate review of permitted current
state. The denied production read must not be replaced by this component or a new
endpoint. Do not use a hidden operator command to issue a permit. The original
case, bounded marker/binding, complete scope, revision and paid-stage identity must
be established through an authorized surface. No new cases or credentials.

The injected `withVerifiedFence({identity, body, requestHash}, callback)` receives
an immutable exact wire and must verify it matches the complete original scope,
saved stage and revision. It must verify the authoritative bounded-QA marker is
present and the deterministic-only marker is absent. It must acquire authoritative
external-spending and draft-revision fences, obtain current accounting evidence,
and hold those fences until the **awaited callback finishes** (including network
dispatch). A plain read-then-callback, boolean approval, stale receipt, or test
adapter is not a production implementation. This component's row lock serializes
the QA ledger only; it cannot fence another database or an external spending
owner. No production implementation of this adapter is provided.

Its snapshot must contain the exact identity, requestHash, boundedMarker:true,
noProviderMarker:false, evidence hash, immutable accounting
epoch, full external reserve in integer microUSD, current QA liability, observation
time and expiry (at most two minutes). The same epoch/evidence and external reserve
must remain valid at dispatch. Changed/stale admission stops before dispatch and
keeps the full reservation. Exact settled receipts remain available for free replay
after approval expiry or restart, without provider credentials or new admission.
Historical unknown charges remain in the external
reserve; active or unknown QA calls block admission. The ledger total is recomputed
from its call rows and checked against both the run counter and supplied evidence.

## Scope and arithmetic

The sole exception is one lifetime request on the original QA run, for one of the
six original cases. It reserves 2,240,000 microUSD in the existing run/call ledger,
under its existing lock and unique active-call index. The singleton admission
record prevents another research request even after settlement. The original
2,000,000 allowance stays unchanged for legacy callers; the prospective exception
enforces a 2,810,000 combined QA ceiling and 10,000,000 aggregate ceiling. An
external reserve of at least 7,190,000 includes the supplied historical/day holds.
It does not grant overlap credits, reset history or release unknown reservations.
Legacy admission still caps total QA liability at 2,000,000, a stricter subset of
the exception's limit. All writers continue to share the same run lock and ledger.

With supplied QA liability43,635, the full proposed exposure is9,473,635 and
remaining headroom526,365. Current authoritative evidence is still required.
This is one research attempt, not a promise of a finished estimate or PDF.

The conditional engineering bound is eleven 200,000-token input passes at $1/M,
6,000 total output tokens at $5/M and one $0.01 search. Eleven reserves one extra
pass beyond the documented default ten iterations; it is not proof of provider
billing internals. Before activation verify standard first-party pricing and no
loop overrides, proxy/SDK retries, caching or rate multipliers. Sources:

- https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons#pause_turn
- https://platform.claude.com/docs/en/build-with-claude/context-windows
- https://platform.claude.com/docs/en/api/messages/create
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- https://platform.claude.com/docs/en/about-claude/pricing

## Request and receipt contract

The validator requires pinned Haiku4.5, a fresh text-only user message, unchanged
system/scope text, exactly one basic search with max_uses1, max_tokens6000,
standard_only and nonstreaming. It rejects extra fields, tools, cache markers and
assistant/tool continuations rather than silently modifying them. Current website
research emits an incompatible broader request and is intentionally not connected
to this component. A future reviewed integration must preserve complete scope and
the existing paid-result identity; it cannot reshape an uncertain call to evade
its hold.

Dispatch uses one direct fetch with redirects disabled and a hard timeout. It has
no retry, fallback or continuation path. Complete response and provider request ID
are stored before settlement. Missing, malformed, unexpected or excessive usage
keeps the full hold and blocks the run. Settlement prices cumulative input/output
and search fees, requiring explicit zero cache usage and standard service tier.
Unknown usage fields fail closed until reviewed. A pause, refusal or truncation
may settle a verified bill but remains an incomplete response; no content-quality
or estimate-completion assertion is returned. Customer-facing acceptance remains
the responsibility of a separately reviewed integration.

## Rollout boundary

Run the isolated `test/restricted-research.test.mjs` and existing QA ledger tests.
Review migration source, default-off isolation, exact validation, concurrency,
expiry, ledger reconciliation, unknown holds and receipt failure behavior. Do not
apply schema or enable dispatch until production access/accounting and the fence
adapter are independently verified. No source change in this batch expands access
or authorizes a paid call.
