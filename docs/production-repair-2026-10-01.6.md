# P5 repair candidate 2026-10-01.6

This is a repair candidate, not production acceptance. Child-site rollout remains paused.

## Changes

- Encode large uniform catalogs without repeated field names and shared values. All rates and qualifications remain available in initial and corrective Anthropic requests. The repository's generated 1,645-rate catalog shrank from 586,404 to 451,660 JSON characters. This is a character measurement, not a token guarantee.
- Require the initial pricing research request to invoke web search. Paused continuations can finish normally. Existing source verification remains mandatory.
- Require structured extraction tool output. Unsupported length and numeric schema constraints move into descriptions; original local validators remain unchanged. Real-provider grammar acceptance and dense-document output limits still require live testing.
- Record gateway upstream identity, safe error code and elapsed time. Logs exclude URLs, headers, filenames, bodies and credentials. This improves diagnosis; it does not establish or repair the prior unknown outage cause.

## Local verification

- Main regression suite: 1,715 passed, 16 skipped, zero failures.
- Anthropic/provider regression suite: 19 passed, zero failures.
- Gateway suite: 6 passed.
- TypeScript check passed.
- Database safety suite: 6 passed. Production build completed successfully.
- Shared manifest refreshed for P5 only, including both new helpers.

## Deployment and remaining acceptance

Production was still on 2026-10-01.5 when this candidate was prepared. Replit browser access was blocked by a security-verification loop. The connector supports publishing but offers no repository pull operation. Pull this commit into the Replit workspace before publishing.

After publishing, verify the release fingerprint, then rerun document extraction and pricing before finishing the 27-source matrix, multi-file, PDF, delivery and mobile checks. The approved document follow-up records the unresolved production failures. No successful live estimate or delivery is claimed by these local tests.
