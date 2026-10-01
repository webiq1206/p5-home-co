# Live retest and repair candidate 2026-10-01.3

## Deployed version checked

The public release endpoint served 2026-10-01.2, source tree `70230e6bbf4bbd68c5abd0f565037f885131c8cc`, clean build, with Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). This matched the pushed candidate. The following failures occurred on that deployment, not an outdated source tree.

## RE10 clarification

The retained browser project was restored through Saved project recovery after a reload selected the most recently saved project across tabs. Its existing radon question remained. One answer explicitly deferred radon design to the specialist and corrected both 32-foot repair and 40-foot excavation quantities to unknown. No new source file was uploaded. The answer stayed in the browser form after failure.

Read-only Replit inspection found these deployment log entries:

| UTC time | Outcome |
| --- | --- |
| 11:48:36.182 | Anthropic HTTP 200 after 27.3 seconds |
| 11:48:36.186 | Invalid reply; one same-provider repair requested |
| 11:49:04.095 | Anthropic HTTP 200 after another 27.9 seconds |
| 11:49:04.098 | Invalid reply again |
| 11:49:04.099 | `analysis-provider-failed:Anthropic (200): clarification-takeoff-identity-invalid [undefined]` |

These logs are time-correlated, not directly draft-linked. There were no saved events for this clarification. The exact returned invalid ID and whether it was unknown, duplicated, or ambiguous were not retained. This is evidence of local identity-validation failure, not a demonstrated provider outage or timeout.

At 11:53:44 UTC, draft `07bb2fe3-29a6-47fd-bf75-6527ffce81d9` remained revision 7, last updated 11:47:29.319. The new answer was not persisted. Two repair items still held quantity 32 with unit `feet from entry`; two inspection/excavation items still held quantity 40 with unit `feet approximate`. The repeated-question and duplicate-work defects remain separate unresolved issues.

Changes in this candidate:

* Clarification output uses a small correction contract containing only an existing ID and quantity. Both provider schemas enumerate eligible existing IDs. The server supplies the original physical identity, units and source metadata.
* Unknown IDs, duplicate updates, ambiguous prior IDs, unsupported numeric amounts and invalid values still fail validation. No fuzzy ID matching or dropped-update success was added.
* Validation errors now distinguish the identity failure reason and update index without logging document text.
* Clarification calls supply their draft identity to the existing per-attempt event logger.
* A confirmed additional code defect was repaired: validation-retry instructions previously replaced and lost the retained-correction instruction. They now preserve it.

This improves the contract and repair path. It does not prove a future real model reply will select every affected item correctly. A production retest is still required.

## Cabinet pricing

One browser retry was submitted for retained draft `24e81e7a-1248-4c86-88c7-7fe69fb42c75`, without customer email or phone. The 1.2 background job started at 11:48:29.130 UTC. Its new traces directly link requests to charge-ledger fingerprints. The configured spending cap was false. Exact matching completed replies can be reused; changing release or request inputs does not guarantee reuse of every stage.

At 11:53:46.223 UTC the job was still running, with 12 completed checks and no final estimate. A directly linked research trace started 11:51:52.052 and failed 11:52:29.891, about 37.8 seconds later, with cause `deadline`. Fingerprint `e3d61de147ef308108a0e44a5608f7f9048c1523e2461d46274b5da321071f2d` had ledger state `unknown`; sequence 1 was unknown, with no provider ID. The saved error was the application's processing-deadline message. Twelve other linked rows were settled. A later research request settled at 11:53:13.077, proving some work continued after the failure.

The deadline closely matches the end of the four-minute processing pass. Code inspection confirmed two mechanisms:

1. Research received the smaller of its normal allowance and the remaining pass time. The admitted request could therefore lose most of its stage allowance.
2. A saved research deadline marker was thrown again on each pass without another request or advancing its timeout count. The outer research path then returned another 30-second pending state. The browser remained at 12 checks for several minutes, eventually showing recovery messaging without a final estimate.

Changes in this candidate:

* Admitted research receives its full configured stage allowance, within the existing maximum. The pass still checks its deadline before admitting new stages. Completed replies retain their checkpoint.
* Actual research deadline markers permit bounded retries up to the existing three-attempt limit. Non-timeout research failure cooldowns and large mapping batch splitting remain distinct.
* Exhausted research ends explicitly for review instead of polling the same exhausted checkpoint indefinitely. It does not invent an uncited price.
* The existing ledger continues to enforce configured spending caps and unresolved-charge rules. Unknown charge acknowledgement is not asserted to be free.

The underlying provider error of the original 1.1 cabinet failure remains unknown. The new trace proves the cause of this new request only.

## Customer PDF

The earlier successful handyman estimate `P5-C5E58F7E` downloaded successfully and contained three lever installations and a $300 to $325 range. The browser download event listener timed out, but the UI changed to Downloaded and the resulting local PDF was inspected directly.

Its PDF placed this contractor work in exclusions: `By others or supplied by the owner: Contractor: labor to remove old levers, install new owner-supplied levers, and dispose of old hardware`.

The renderer treated any responsibility containing the word owner as non-contractor work. The candidate removes that actor inference. Responsibility statements retain their original wording in a Responsibilities row. Explicit exclusions remain exclusions. PDF and email regression checks exercise the actual presenters.

The same historical PDF also contains a generated assumption assigning installation/disposal to the owner. That is a separate saved-content inconsistency, not fixed by moving responsibility statements. Historical output is therefore not fully accepted as accurate.

## Verification and remaining work

* Database-safety checks: 6 passed.
* Retained-provider suite: 1,714 tests, 1,698 passed, 16 skipped, zero failures.
* Selected-Haiku suite: 17 passed, zero failures.
* Production compilation and TypeScript passed.
* Final shared-manifest and production-error checks: 8 passed.
* Repository lint remains at the existing baseline of 908 errors and 105 warnings; this candidate adds no net lint errors or warnings.
* Tests use controlled provider responses. The correction test rejects an invented ID first, verifies the retained correction contract survives repair, then accepts a compact valid update. These are code-path checks, not evidence of successful production interpretation.
* Research checks cover serialized timeout markers and an exhausted research path through the full scope-pricing function. They do not qualify real provider timing or concurrent workers.

The candidate remains Haiku by default, retains explicit OpenAI selection and does not roll out to child sites. Original measurement-role errors, source provenance, duplicate work, repeated decision identities, Goeckner regional coverage, generated assumption consistency, final pricing accuracy and delivery qualification remain open. The public workflow has not been declared finalized.
