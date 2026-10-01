# Estimator correction checkpoint 2026-10-01.5

P5-only. The complete estimator correction plan remains open. This checkpoint addresses the actual cabinet failure after deployment of 1.4; it does not certify other estimate types.

## Production evidence from 1.4

The public release receipt reported version 2026-10-01.4, deployed commit `4044624dadaf1b1c4d1a8999ecd9298a81874330`, clean tree `05b583681ae7ca6301d45ab9be89227afc495bcb`, matching the tested GitHub tree. Haiku 4.5 remained selected, without fallback.

The preserved cabinet draft `24e81e7a-1248-4c86-88c7-7fe69fb42c75` was submitted once. Its background job `background-v1-f308a08ee22deafc45f3519e27ed22e9fc03c8ec11b70aed6ce3f71b8b50f9d1` was created at 13:32:20.239 UTC and completed at 13:32:54.449 UTC. The submission finished at 13:32:54.401581 UTC with outcome `needs-review`, no customer range, and internal issue `Automatic pricing did not complete: Error: Incomplete mapping batch`. Background completion is not pricing acceptance.

Read-only Replit inspection of the directly linked work `pricing-v11-4c1f2c76f98ec7cc8af36f1662214f9e87e82c20bd8e3cc6cd2c83c7ba1722d0` found four settled/completed mapping requests, all with empty transport-failure arrays. Two saved replies had `tasks` as invalid JSON text, lengths 1,811 and 3,835 characters. Later replies had arrays:

* `CAB-INSTALL-BASE`, `CAB-INSTALL-UPPER`, `CAB-INSTALL-SITE-CLEANUP`.
* `BASE-CAB-INSTALL-12LF`, `WALL-CAB-INSTALL-8LF`, `CAB-FILLER-STRIPS`, `CAB-INSTALL-CONSUMABLES`.

Expected request task IDs and repair-parent flags were not retained. The exact mismatched batch cannot be established from those records. No new failed search request was recorded, so this run does not establish the cause of the earlier empty-source search failures. Their new diagnostic fields were absent, not empty.

The customer-visible result is preserved in [the live cabinet screenshot](evidence/p5-cabinet-live-20261001-14.jpg). It is evidence of the 1.4 failure, not a successful 1.5 production result.

The code accepted schema-valid mapping replies inside `mapBatch` before checking exact task coverage outside its repair path. Thus an omitted, duplicated or renamed task bypassed corrective handling and became a terminal generic error. Later remapping batches also lacked the exact-ID check.

RE10 draft `07bb2fe3-29a6-47fd-bf75-6527ffce81d9` restored the latest explicit correction that 32 feet is a damage location and 40 feet is an inspection observation, not repair/excavation quantity. Updated-client continuation reached revision 10 with analysis complete at 13:38:43.898 UTC. The inappropriate labor-hours question did not appear. The UI instead repeated the already-addressed sewer repair length/method decision under Utilities. The saved-answer filter applied only to unbound instruction questions; field binding bypassed it. Authored Q&A folded into project text during recovery/editing was also absent from that check. The literal live wording reproduces the defect locally. No replacement answer was submitted to conceal it. The correction below requires a live retest; complete stable-ID migration is still unfinished.

The preserved Goeckner draft `f1b23916-67d2-45b3-afe2-c9f14362595c` was retried once. Its job was created at 13:45:37.636 UTC and failed at 13:46:36.896 UTC with `incomplete-source`, HTTP 422. All 52 units have completed results: 49 reused, three reread (object suffixes 11 at 13:46:00.916, 22 at 13:46:29.672, and 28 at 13:46:36.469 UTC). The diagnostic connector initially timed out; its completed findings were retrieved without another inspection or paid reread.

Original page 3 regions 1–6, 7–12 and 13–18 were legacy `read` records without `coverageState`; reread regions 19–24 were `partial` / `unspecified`. Every view passed individually. Merging discarded the typed state because of the older neighbors, then wrongly rejected this typed note: `Sheet scale noted as 1/4" = 1'-0" but dimensions and areas not readable in provided crops`. This is an aggregation defect, not evidence of a new illegible region. The other two reread units were `read` / `readable` and passed. Sheet identities, quantities and overall interpretation remain unqualified.

A read-only dry evaluation against all 52 saved results confirmed that the proposed merge yields 13 covered original pages, without another provider call. It also exposed one remaining legacy prose blocker from original page 7 regions 1–6: `All six detail regions (1-6) within the crop grid are legible. No regions were blank or unreadable.` The negation parser did not recognize that sentence. The narrow negation correction below includes tests proving that a separate genuinely unreadable schedule still blocks.

The retained area facts remain semantically inconsistent: 497 SF (26 + 471), 471 SF (upper addition only), 495 SF (ventilation basis), low-confidence inferred 2406 SF, and a saved calculated 5009.06 SF paired with incompatible arithmetic. These are saved statements, not accepted project quantities. Passing coverage does not qualify them or establish correct sheet identities. No merged draft extraction was yet persisted for this plan set.

## Changes

* Compatible native pricing tools opt into Anthropic `strict: true` to enforce response field types. The separately generated project-record schemas retain their prior mode because they contain unsupported numeric/string constraints and require a separate adaptation.
* Mapping response schemas restrict task IDs to the actual supplied batch. Server validation additionally requires every expected ID exactly once, including remapping and corrective stages.
* Format and coverage defects share one bounded corrective request carrying the unchanged task batch, exact failed response, and structured validation errors. A second invalid result cannot release a partial total. Existing malformed-addition handling must also pass full task coverage.
* Corrective response context has deterministic object-key ordering, preserving the same saved request identity after PostgreSQL JSONB reload. The SQL recovery test caught and verified this requirement while developing the change.
* New private request traces retain expected task IDs, repair type, returned task IDs and task-list data type. Future coverage failures can be tied to their actual request rather than inferred from response wording.
* Coverage merging first evaluates each original view under its own contract. A passing legacy view cannot discard a newer accepted typed state; a failing legacy view still blocks the merge. Typed page notes are reconciled only to that covered page, even when other fully covered pages use legacy records. Original records and unrelated preparation failures remain intact.
* Explicit legacy negations such as "No regions were blank or unreadable" do not become read failures. This removes only that negated clause, retaining separate real failures in the same note.
* Complete answered Q&A is recognized in saved estimating instructions and authored project text. Binding a repeated instruction to a field cannot bypass answer continuity; corresponding repeated field clarifications are filtered before generating generic field questions. Actual conflicts, separate named utilities, distinct measured components and unanswered questions remain visible. This extends the existing conservative legacy comparison; it is not a complete semantic decision-ID migration.

Provider references checked October 1, 2026:

* https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
* https://platform.claude.com/docs/en/build-with-claude/structured-outputs

Strict mode supports Haiku 4.5, but it does not establish correct quantities, responsibilities, source interpretation, or pricing. Existing semantic validation remains necessary.

## Verification and remaining gate

The isolated SQL pricing recovery test exercises missing, duplicated, substituted and text-valued task lists, successful correction, repeat failure, exact saved diagnostic metadata, and reuse after database reload without additional provider calls. All provider transport is synthetic and unexpected networking is rejected. Targeted scope-pricing tests passed, 165 of 165. Coverage regressions include the exact live page-3 note with three legacy neighbors, a legacy page elsewhere in the document, a truly unreadable legacy region, and unrelated preparation failure.

Final verification: database safety 6 passed; main retained-provider suite 1,728 total, 1,712 passed and 16 skipped; selected-Haiku suite 18 passed. Zero test failures. Production compilation and TypeScript passed. Lint remains at the pre-existing baseline of 908 errors and 105 warnings. The isolated SQL pricing-recovery script also passed with live networking disabled. No production database was used for local checks.

This release still requires live deployment and the saved cabinet, RE10 and Goeckner retests. The remaining acceptance list in `estimator-correction-2026-10-01.4.md` continues to apply, including complete decision-ID migration, duplicate physical work, Goeckner title-block identity/area, final output consistency, delivery, broader original-source cases and self-repair governance. No provider credentials, schema migrations, child-site rollout or automatic code deployment are included.
