# Follow-up verification, September 26, 2026

This supplements the audit implementation register. It does not mark all audit work complete.

## Additional source changes
- Hide child marketing sticky actions over the hero, while editing a field and beside a final on-page CTA.
- Show the three largest priced categories and the first three listed assumptions without opening an accordion. Add expand-all and collapse-all controls; retain every detail.
- Surface saved human-review requests and immutable contact/scope snapshots in authenticated estimator administration, including requests whose email notification failed.
- Bound the review form wait and distinguish uncertain confirmation from failure; retry uses the existing deduplication key.
- Cabinet: photo-proportion estimates remain unconfirmed and low-confidence. Confirmation explains that they are planning sizes, not measurements. File-read failures release the loading state.
- Repair stale isolated test fixtures to use required OpenAI GPT-4.1 response evidence, including the adversarial document suite. No production model guard, provider policy or pricing formula was weakened.
- Construction: correct address-dependent permitting in 12 location guides and health-district references for Canyon County. Official Star and Middleton sources added to applicable permit helpers.

## Checks
- Canonical unit suite: 744 passed, 0 failed, 6 skipped.
- Isolated SQL/document adapter, background jobs, receipt, workflow, upload, document preparation, input identity and recovery scripts passed.
- Resumable integration passed with a synthetic 25 MB, 250-page PDF, final-page coverage, failed-page retry and deduplication. AI and object storage were simulated.
- Adversarial document integration passed 17 scenarios locally after the fixture correction.
- Cabinet photo-provenance regression passed.
- Local production builds completed for all five sites. Cabinet prebuild passed, then Next build passed after removal of its generated export cache following an ENOTEMPTY cleanup failure.
- Independent TypeScript checks passed for all five sites.
- Round-two GitHub interface and metadata checks passed for all five sites; they cover homepage widths 320, 390, 768 and 1440, mobile action behavior, and sitemap-page metadata. They do not constitute visual review of every page or physical-device testing.
- Round-two cabinet E2E passed. The shared conversation CI suite needs a rerun with the adversarial fixture correction in this commit.
- No new Lighthouse, CrUX or field performance measurement is claimed.

## Production and remaining limits
Read-only Replit inspection reported construction runtime errors around 14:31 UTC on September 26: OpenAI HTTP 429 RATELIMIT_EXCEEDED, then the older deployed fallback's configured usage cap. This is provider capacity evidence. Current draft source requires GPT-4.1 and does not restore that fallback. No billing limits, secrets or production settings were changed.

An isolated TEST ONLY construction preview was prepared from f40a172082028dfd4604e998d58581e99bff5f27 with backend actions and production integrations blocked. Replit reported homepage and estimator HTTP 200. Main application source and production deployment remained unchanged; temporary preview files and a workflow entry were added. The preview domain was blocked in the audit browser, so direct visual approval is not claimed.

Release still requires current CI and live provider, database and email verification. Genuine project photography, business facts and analytics-dependent keyword/redirect decisions remain open. No merge or production publication is part of this verification note.
