# Retained pricing evidence for the .11 synthetic failure

The saved synthetic project `d18a6984-36e9-469d-bbc3-655fdda475da` ended in review with no customer range. Its production export is preserved byte-for-byte in `tests/fixtures/p5-main11-saved-failure.json` (SHA-256 `8689566ab270bb3066c581ec8458d1260483a4a8c2cf07c977892ee88da267fb`; production internal JSON MD5 `cb5b054a3005740b0bcd72151c999c8a`).

The actual ledger has **$210 hardware replacement labor plus one $75 supporting-work allowance, $285 direct cost**. It does not retain the $225 whole-door removal proposal. Deterministic rate admission already rejected that proposal. The canonical hardware rate is explicitly labor-only. The audit nevertheless repeated the rejected removal proposal and the mapper's unsupported consumables-in-labor claim as current facts and blockers. The same mapping prose was also accepted as scope-assumption advisory text.

The correction supplies the existing audit call with a server-built `currentPricing` snapshot: positive retained line IDs, quantities, unit costs, direct totals, exact canonical rate matches, task links, and explicit allowance assignments. Mapping notes and proposals are placed in historical context rather than active task notes. Their ledger provenance is `pricing-history`, so a model cannot simply relabel them as original-scope assumptions. Both initial and repaired audits use this boundary. Original histories remain retained internally; no blocker is removed merely because its wording is undesirable. Non-policy audit inputs preserve their prior behavior.

This changes neither prices nor provider call/budget limits. Unknown canonical matches stay unknown. Actual extra charges remain visible. Scope hazards, missing pricing, overlaps, and unproven or incomplete audit dispositions retain their existing protections. The audit prompt and request content change naturally invalidate incompatible saved stage replies.

The exact saved resolution reproduces the failed result offline. It deliberately remains blocked when replayed with its old contradictory audit: this correction requires a fresh grounded audit, not silent release of an old failure. Regression tests verify the fresh audit's input boundary and origin enforcement, preserve original source evidence, and exercise zero/changed amounts, units, categories, real additional charges, and existing typed-blocker protections.

A passing local suite does not prove the fresh provider response or customer workflow succeeds. No new production estimate, source import, or publication was performed during this correction. A coordinated release and bounded live acceptance remain necessary.

Validation: 200 focused tests passed. Full `npm run build` passed: 1,851 main tests, 16 existing skips, 19 provider checks, six database-safety checks, and Next/TypeScript compilation. The release identifier was subsequently bumped to `2026-10-02.12`; no pricing code changed after that build.
