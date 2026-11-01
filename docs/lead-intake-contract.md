# Lead intake contract (two-step forms)

P5 Home Co owns the HubSpot path for the whole family. Every brand site posts
its leads to `POST https://p5homeco.com/api/leads/intake` (JSON), and P5 stores
the deal and syncs it to HubSpot. This page is the contract the four brand
sites code to. Source: `app/api/leads/intake/handler.ts`,
`app/lib/leads/intakeContract.ts`, `app/lib/leads/intake.ts`.

Everything below is optional. A post with none of the new fields is handled
exactly as before (pinned by `tests/lead-intake-merge.test.ts`).

## Fields

Existing fields are unchanged: `brand` (required, one of the six brand names),
`name` or `firstName`/`lastName`, `phone`, `email` (one of the two required),
`projectType`, `address`, `city`, `summary` (or `message`/`description`),
`form`, `source`, `sourceDetail`, `externalLeadId`, `campaign`, `utm_*`.
Body limit 32 KB.

New, all optional:

| Field | Values | Notes |
|---|---|---|
| `submission_kind` | `"initial"` (default) or `"details"` | `"details"` is Step 2, see merge rules. |
| `external_id` | string, up to 200 characters | The brand's own request id. Must be the same in Step 1 and Step 2. Scoped by `brand`, so two brands never collide. |
| `request_kind` | `"quote"` or `"callback"` | A callback's deal summary and HubSpot description start "Callback request". |
| `contact_preference` | `"call"`, `"text"` or `"email"` | |
| `best_time` | string, up to 120 characters | Best time to call, as the visitor chose it. |
| `timeline` | string, up to 120 characters | Soon / 1 to 3 months / 3 to 6 months / Just planning. |
| `zip` | string | Appended to `address` when it is not already in it. |
| `files` | array of `{ name, url, contentType, size }` | Up to 20. `url` must be an absolute `https` link the team can open (an unguessable or admin-gated link the brand site serves). Entries without a usable link are dropped, never fatal. P5 stores the link, never a copy. |

Accepted spellings: `submissionKind`, `externalId`, `requestKind` (or
`request_type`), `contactPreference`, `bestTime`, `timing`, `postal_code`,
`content_type`/`type` inside a file entry. Unknown values are ignored.

## Step 1: `submission_kind` absent or `"initial"`

Creates the lead as today, plus: stores `request_kind`, `contact_preference`,
`best_time` and `timeline` on the deal, keeps the file links, and records
`(brand, external_id)` against the deal.

- Same `brand` + `external_id` again: `200 { ok: true, duplicate: true }`, no
  second deal. New file links on a repeat are still kept.
- A repeat that matches an open deal some other way (same person, brand and
  project) attaches its `external_id` to that deal, so its Step 2 still lands.
- A Step 1 that finds its deal already there (its Step 2 got in first, or a
  repeat carries something new) merges into it under a "Request received:"
  block with the same fill-only-blanks rules, and fills a blank request kind.
  Still `200 { ok: true, duplicate: true }`, never a second deal. An identical
  repeat of Step 1 changes nothing.
- Any Step 2 held for this `external_id` (see below) merges as soon as Step 1
  creates or finds the deal.
- The summary may say "Files: N uploading" when the files follow in Step 2;
  that text is kept as written.

Responses: `201 { ok, accepted: true, duplicate: false, message }` when
created, `200 { ok, duplicate: true }` for a repeat, `422 { ok: false, errors }`
when there is no name or no way to reach the person.

## Step 2: `submission_kind: "details"`

Send `brand`, the same `external_id`, and any of `projectType`, `address`,
`zip`, `city`, `timeline`, `best_time`, `contact_preference`, `email`,
`summary` and `files` (`[{ name, url, contentType, size }]`, for files the
brand uploaded after Step 1). Contact fields may be repeated; they are not
required. Step 2 may arrive seconds after Step 1, or before it.

Merge rules (one transaction, `mergeLeadDetails`):

- Fill only what is empty. Address, city, timing, best time and contact
  preference are set only when the deal has none. A Step 1 answer is never
  overwritten, by a blank or by a different value.
- Project type replaces only a blank or a "not sure" answer ("Something else,
  or I am not sure", "Not sure", "Other"). A brand post never changes the brand.
- Email is added to the contact only when the contact has none.
- Nothing is dropped: every Step 2 post appends a "Details added:" block (one
  line per detail and file) to the deal summary, adds a timeline entry and an
  audit row, and appends new file links.
- The deal is marked for HubSpot re-sync. The next sync updates the HubSpot
  deal and adds one note per details post.
- The team gets a short follow-up email, "Details added: {name} · {brand}".

Idempotency: each post is fingerprinted (SHA-256 of the normalized details;
file order and letter case do not matter). The same details posted again
change nothing and answer `duplicate: true`. Different details are a new
post and merge again.

Responses:

- `200 { ok: true, merged: true, duplicate: false }` merged.
- `200 { ok: true, merged: false, duplicate: true }` already received.
- `200 { ok: true, merged: false, duplicate: false }` nothing to add.
- `400` when `external_id` is missing.
- `202 { ok: true, merged: false, pending: true }` when no deal has that
  `brand` + `external_id` yet and the post carries no phone or email: the
  details are held (`lead_pending_details`, idempotent by fingerprint) and
  merge the moment Step 1 arrives. Never dropped, never a duplicate error.
- `201 { ok: true, accepted: true, merged: false }` when no deal exists yet
  but the post carries a phone or email (for example Step 1's forward failed):
  it becomes the lead under the same `external_id`, and the late Step 1 then
  merges into it.

Out of order, in every case: one deal per `brand` + `external_id`, and every
detail and file ends up on it.

## Limits

A brand server forwards every visitor's lead from its own address, so limits
are keyed on the lead, not only on the connecting address. Real leads are never
refused for sharing a server with other visitors.

- New requests: 5 per hour per `brand` + person. The person is the phone's
  digits (formatting and a leading US 1 ignored), else the lowercased email.
  Repeats beyond that get 429 "We already have several requests from you this
  hour". A post with neither phone nor email falls back to its address, 5 per
  hour, as before.
- Step 2 (`submission_kind: "details"`): 20 per hour per `brand` +
  `external_id`, counted apart from new requests, so adding details never uses
  up the allowance for new requests. A Step 2 post that becomes a new lead (no
  deal yet, with a phone or email) also counts as a new request.
- Spam backstop: a ceiling per connecting address AND `brand`, 120 new requests
  and 240 Step 2 posts per hour. Each brand's forwards are counted apart from
  P5's own browser posts and from the other brands. A refusal is logged as
  `[intake] rate limited` with the brand, kind, reason and `sourceDetail`
  (never the person), so a brand meeting its ceiling is visible.
- Counters are HMAC keys (SESSION_SECRET), so no address, phone or email is
  stored in the clear. Windows are fixed clock hours.
- Unchanged: honeypots (`website_url`, `company_website`) are refused with 422;
  bodies over 32 KB are refused with 413 (now measured on the bytes read, not
  only on `content-length`); a repeat of the same lead while its deal is open
  is a 200 duplicate on that deal, not a second deal.
- P5's own short-request routes (`/api/leads/short-request` and its `details`
  and `files` routes) are called by the visitor's browser, so their address is
  the visitor's and they keep their per-address windows (5 new, 40 follow-ups
  per hour).

## HubSpot

Gated as before: nothing is called unless `featureFlags.hubspotIntegrationEnabled`
is on and `HUBSPOT_TOKEN` is set. Sync never blocks intake.

- Deal description: the summary (so a callback starts "Callback request" and
  every "Details added" block is there), then request kind, preferred contact,
  best time, timing and one file link per line for any of those without a
  property on the portal.
- Properties, used only when the portal has them (`npm run hubspot:setup`
  creates them): `p5_request_kind`, `p5_contact_preference`, `p5_best_time`,
  `p5_timeline`, `p5_file_links`. Until then the description carries them.
- Notes: one per details post, associated to the deal, with clickable file
  links. A token without the notes scope (401/403) falls back to the
  description, which already has the details, and is not retried.
- P5's own uploads appear as admin-gated links,
  `https://p5homeco.com/api/admin/lead-files?id=N` (sign in required).

## P5's own form

`/quote` uses the same merge internally. Step 1 posts to
`/api/leads/short-request` and gets back `request: { id, token }`, an
HMAC-SHA256 token (keyed by `SESSION_SECRET`, valid 2 hours). Files then go
one per request to `/api/leads/short-request/files` (`id`, `token`, `file`,
`final`), and Step 2 to `/api/leads/short-request/details` (JSON `id`,
`token`, `project`, `address`, `timing`, `email`). A token can only add to its
own request, never read it. On P5's form a Step 2 project type also routes a
"not sure" request to the company that owns the work.

## Database

Migration `021_lead_details.sql`, additive only, applied by the startup
migrator (`npm run db:migrate` before `start:host`): deal columns
`request_kind`, `contact_preference`, `best_time`, `timeline`; tables
`lead_external_ref` (brand + external id to deal), `lead_file_link`,
`lead_details_event` (fingerprints and HubSpot note state), and
`lead_pending_details` (Step 2 posts waiting for their Step 1).
