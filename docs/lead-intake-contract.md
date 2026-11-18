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
`/api/leads/short-request` (with an optional `address`, stored as the lead's
property address) and gets back `request: { id, token }`, an
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

## Everything submitted, immediate HubSpot sync, alerts (release 2026-11-09)

Every field of an accepted post is now kept, not only the ones above: the
whole JSON body (honeypots excluded) is stored as label/value pairs in
`lead_intake_submission` and sent to HubSpot as one note per distinct
submission, on the contact and the deal, with the attribution. Unknown keys
are labelled from their names (`budget_range` reads "Budget range"); nested
objects read "Answers: Cabinet style"; arrays join with commas.

Fields the brand bridges should send (all optional except `brand` and one of
`phone`/`email`):

| Field | Type | Notes |
|---|---|---|
| `brand` | string | One of the six brand names. |
| `name` or `firstName` + `lastName` | string | |
| `phone`, `email` | string | One required. |
| `address` (or `street_address`) | string | Street only. |
| `city`, `state`, `zip` | string | `state` and `zip` now reach the HubSpot contact's own fields. |
| `projectType` | string | Visitor's words; HubSpot gets a sanitized enum. |
| `summary` | string | The visitor's message. |
| `timeline`, `best_time`, `contact_preference`, `request_kind` | string | As above. |
| `budget` | string | Kept verbatim (note and email). |
| `answers` | object of string, number, boolean or string[] | Every custom question, verbatim. |
| `files` | array of `{ name, url, contentType, size }` | https links. |
| `form`, `source`, `sourceDetail`, `campaign`, `service` | string | |
| `external_id`, `externalLeadId` | string | Idempotency. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | string | |
| `gclid`, `gbraid`, `wbraid`, `fbclid` | string | Click ids; `fbclid` is new and alone marks the lead "Social Media". |
| `landing_page`, `referrer` | string | Path (campaign params only) and origin. |
| `first_*` variants of the above | string | First touch. |

After the deal commits the hub syncs it to HubSpot inline (bounded, default
4 s, `HUBSPOT_INLINE_SYNC_TIMEOUT_MS`), with contact address/city/state/zip and
`hubspot_owner_id` (97300513 unless a mapped P5 owner applies), then emails
`New lead: <Brand> | <Project> | <Name> | <City>` with call/text/email/maps
links and the HubSpot contact and deal links. The watchdog stays the retry
path. Only HubSpot portal 247066159 is ever written. Details:
docs/meta-leadgen-setup.md.

## One team email per request (17 November 2026)

A request from a brand site used to produce two team emails in the same inbox:
the site's own and the "New lead" email sent here. Two optional fields let the
site make this one the only one, and keep its own as the fallback.

| Field | Meaning |
| --- | --- |
| `team_alert: "confirm"` | The team email is sent before the answer, and the answer says whether it went. |
| `team_alert: "site"` | The calling site has already emailed the team about this submission, so no team email is sent from here. The document estimator only: see "The document estimator on a brand site" below. Ignored for every other post. |
| `team_notes: string[]` | Lines for the team only (the site's planning range, the parcel it looked up, its dashboard link). At most 40 lines of 300 characters. Printed in the team email under "From the website". Not stored on the lead and not listed under "Everything submitted". The email itself is copied into HubSpot by the inbox sync, so never send a cost, margin, markup, profit, contingency or overhead figure: a line that names one is withheld and counted. |

| `team_internal_notes: string[]` | The site's INTERNAL lines for the team: its cost, margin and pricing checks for a planning range. At most 60 lines of 300 characters. Printed under "Internal pricing". When any are sent, the email's subject is "Lead and pricing: ..." instead of "New lead: ...". The inbox sync copies only "New lead" mail into HubSpot, so this email stays out of it. Not stored on the lead. |

With `team_alert: "confirm"` the JSON answer gains `alert`:

* `"sent"`: the mail server accepted the team email.
* `"failed"`: it did not, or it was still sending after 20 seconds (it is left to finish).
* `"none"`: this submission produced no team email (an exact repeat, or details waiting for their request).

The calling site sends its own team email unless `alert` is `"sent"`. A caller
that does not send `team_alert` is answered exactly as before and the email
goes after the response. An answer in this mode can take up to about 25
seconds (the HubSpot links are waited for, then the mail server), so the site
must wait for it off the visitor's path.

Guard: `tests/lead-intake-confirm-alert.test.ts`.

## The price the website gave: `estimate` (site estimates into QuickBooks, 17 November 2026)

Owner decision: every estimate a website gives a visitor becomes a customer and
an UNSENT estimate in QuickBooks. A request that carries a planning range
sends it as `estimate`, and P5 creates the QuickBooks customer and estimate
for the lead after the answer. Optional: a post without it is handled exactly
as before. Source: `readSiteEstimate()` in `app/lib/leads/intakeContract.ts`,
`app/lib/leads/site-estimate.ts`.

```
estimate: {
  kind: "planning-range" | "document",
  low: number,       // the range the customer was shown
  high: number,      // equal to low for one firm price
  base?: number,     // the ONE figure QuickBooks will total. Default: the sum
                     // of the line amounts, else the midpoint of low and high
  label?: string,    // what it is for: "Kitchen remodel, mid-range, 180 sq ft"
  lines?: [{ title: string, description?: string, quantity?: number,
             unit?: string, amount: number, division?: string }],
  verified?: boolean // true only when the site recomputed the figures on its
                     // own server; absent or false when they came from the browser
}
```

Customer prices only. Never send a cost, margin, markup, profit, contingency
or overhead figure in any field of it: QuickBooks holds the customer's
estimate, and those stay on the site (they travel in `team_internal_notes`).

How it is read:

- Forgiving, never fatal. Anything malformed means "no estimate": the lead is
  saved and answered as usual, and the reason is on the lead's audit trail
  (`site_estimate_skipped`). Never a 4xx for an estimate.
- Numbers must be finite and above zero (a plain numeric string is accepted),
  `low <= high`, at most 60 lines, strings trimmed to one line and capped
  (`label` and `title` 200, `description` 1,000, `division` 80, `unit` 20
  characters), amounts rounded to the cent. A line with amount 0 is left out.
- With lines, the total IS the sum of the lines. A `base` that differs from it
  by more than a cent is replaced by the sum, and that is noted.
- Ceilings: an estimate whose total is above $5,000,000 is ignored, and so is
  one above $500,000 unless `verified` is the boolean `true`. A total that
  does not belong to its range (under half of `low`, or over twice `high`) is
  ignored too.
- `division` is the trade, room or two-digit division code as the site names
  it. It chooses the heading the line is listed under and, when it is named
  exactly "Permits", "Design", "Plans & Engineering", "Freight" and the like,
  the QuickBooks item (`SITE_ESTIMATE_ITEMS`). Otherwise the line books to its
  brand's item.
- `quantity` and `unit` are kept when the quantity divides the amount to the
  cent (QuickBooks requires amount = quantity x rate). Otherwise the line is
  one lump sum and the quantity is said in its description.
- It is not a submitted field: not stored on the lead, not in the deal
  summary, not sent to HubSpot, not printed in the team email. Send the
  planning range for the email in `team_notes` as before.

What P5 does with it, after the answer and never on the visitor's path:

- One scope project per lead and `kind`, one QuickBooks customer (an existing
  customer with the same email or phone is linked; otherwise one is created)
  and one estimate, created unsent, whose total is `base` to the cent. The
  range travels as words on the estimate's message and private note, with the
  tool it came from and whether the site verified it.
- Send it with Step 1, and repeat it unchanged in any later post for the same
  `external_id` if that is simpler: a repeat changes nothing. If the visitor
  changes their selections, send the new `estimate` (Step 1 again, or Step 2):
  the same QuickBooks estimate is revised, never a second one, as long as
  nobody has worked, sent or answered it. Once a person has, the new figures
  are only noted on the lead.
- The answer to the post does not change and does not wait for QuickBooks.
  If QuickBooks is unavailable P5 retries by itself for a fortnight.

A request with a planning range split by trade (Boise Remodeling Co):

```json
{
  "brand": "Boise Remodeling Co",
  "name": "Pat Example",
  "email": "pat@example.com",
  "phone": "(208) 555-0142",
  "projectType": "Kitchen remodel",
  "address": "123 N Main St",
  "city": "Boise",
  "zip": "83702",
  "form": "Consultation request",
  "external_id": "4316f6cea2de",
  "request_kind": "quote",
  "team_alert": "confirm",
  "team_notes": ["Planning range shown to the visitor: $32,000 to $41,000 (mid-range)"],
  "estimate": {
    "kind": "planning-range",
    "low": 32000,
    "high": 41000,
    "label": "Kitchen remodel, mid-range, 180 sq ft",
    "verified": true,
    "lines": [
      { "title": "Flooring", "division": "FLOORING", "amount": 8200, "quantity": 410, "unit": "SF" },
      { "title": "Cabinets and countertops", "division": "COUNTERTOPS + CABINETRY", "description": "Shaker cabinets, quartz tops", "amount": 21450.10 },
      { "title": "Permits", "division": "Permits", "amount": 349.90 },
      { "title": "Plumbing", "division": "PLUMBING", "amount": 6000 }
    ]
  }
}
```

The lines add up to 36,000, so that is the estimate's total; `base` is not
needed. Each `amount` is the customer's price for that trade (the email's
"Customer" column), never our cost.

A request whose wizard prices each room as a range (Boise Cabinet Co). A line
has one amount, so send the middle of each room's range and say the range in
its description; `low` and `high` are the whole project's range:

```json
{
  "brand": "Boise Cabinet Co",
  "name": "Pat Example",
  "email": "pat@example.com",
  "phone": "(208) 555-0142",
  "projectType": "Kitchen cabinets",
  "form": "Cabinet consultation",
  "external_id": "9f2c1d7a",
  "team_alert": "confirm",
  "estimate": {
    "kind": "planning-range",
    "low": 16500,
    "high": 21500,
    "label": "Cabinets for 2 rooms, painted shaker",
    "lines": [
      { "title": "Kitchen", "description": "Planning range $13,000 to $17,000. 24 linear feet, painted shaker", "amount": 15000 },
      { "title": "Primary bath", "description": "Planning range $3,500 to $4,500. 6 linear feet, painted shaker", "amount": 4000 }
    ]
  }
}
```

A planning range with no split is the same without `lines`; send `base` when
the range is built on a figure other than its midpoint.

Guards: `tests/site-estimate-contract.test.ts` (the reading, no database) and
`tests/site-estimate.integration.test.ts` (needs `TEST_DATABASE_URL`).

## The document estimator on a brand site: project requests and published estimates (18 November 2026)

The document estimator (`/estimate/scope`, shared code in `lib/p5`) runs on all
five sites. On p5homeco.com it saves its leads in the same process. A brand site
posts them here, with the shared code in `lib/p5/p5LeadIntake.ts` (published to
the brand repositories by `scripts/p5-sync.mjs`; never copied by hand):

1. The visitor's unpriced PROJECT REQUEST ("Send project request"), form
   `p5-project-request`. The `crm` channel of the request delivery posts it
   (`p5LeadIntakeTransport()`). It becomes a lead and a HubSpot deal in the
   first stage. There is no price, so it carries no `estimate` and nothing goes
   to QuickBooks.
2. The ESTIMATE the team later prices and publishes for it, form
   `p5-estimator`, with `estimate` of kind `document`. The brand's delivery
   adapter posts it (`forwardEstimateToP5()`). It joins the request's lead and
   becomes the QuickBooks customer and an UNSENT estimate, as any `estimate`
   does.

### One team email: `team_alert: "site"`

The document estimator emails the team itself before it posts: the whole
request with its files (the request's own `team` channel), and later the
internal estimate record with the administrative PDF. A "New lead" email from
here would be a second email for the same thing, which the owner ruled out (17
November 2026). So both posts say `team_alert: "site"`, meaning "this site has
already emailed the team; send nothing".

It is believed only for the document estimator (`siteSentTeamEmail()` in
`app/lib/leads/intakeContract.ts`):

- form `p5-project-request`, or
- form `p5-estimator` AND a readable `estimate` of kind `document`.

Then no "New lead", "Details added" or "Request added" email is sent for that
post, and the JSON answer carries `alert: "none"`. In every other case (another
form, no `estimate`, one that cannot be read, kind `planning-range`) `"site"` is
ignored: the email goes after the response and the answer is exactly what a
caller that sent no `team_alert` gets. A lead must never end with no team email
because of a malformed post. `team_alert: "confirm"` keeps its meaning.

What `"site"` can and cannot do. The intake has no caller authentication, so
`"site"` is the caller's word, like `verified`. All it does is withhold one
email. The lead is still saved, still syncs to HubSpot in the first stage (the
column the team works from) with its first-contact task and the watchdog's
alerts, and an estimate is still held to the same reading and ceilings
(nothing above $5,000,000; nothing above $500,000 unless `verified: true`; a
total that belongs to its range). It cannot change a lead, hide one, or put a
figure in QuickBooks that an ordinary post could not.

### One lead per project: `external_id` and `request_external_id`

| Post | `external_id` | `request_external_id` |
| --- | --- | --- |
| Project request | The request's lead key, `p5-intake-<sha256 of the project id>`: one per project, the same for every revision. | Not sent. |
| Published estimate | `p5-estimator:<draft id>`: one per draft, the same for every revision. | The lead key of the request it answers. |

- A request sent again (the delivery retries a post whose answer was lost, for
  up to two hours) is answered as a duplicate: no second lead, no email,
  nothing new for HubSpot. A revised request is the same lead with its new
  words added.
- A request is filed under the PRIMARY TEAM it was routed to (`brand`), which
  need not be the brand of the site that took it or of the site that later
  publishes the estimate. So the estimate names the request by its key, and the
  intake attaches the estimate to the lead that holds that key under ANY brand
  (`findExistingDeal()` in `app/lib/leads/intake.ts`). Only a key in exactly
  that format is looked up this way; anything else in `request_external_id` is
  ignored. It is not a submitted field.
- With no such lead (the request was never forwarded), the estimate is matched
  or created like any other submission.
- A different project from the same person has a different key. It joins an
  OPEN lead for the same person, brand, address and kind of work, as every form
  does, and is a new lead when that one is closed.
- An estimate published again with the same figures changes nothing. New
  figures revise the same QuickBooks estimate while nobody has worked it.
- The same person may be asked "several requests this hour" (429) after five
  new posts for one brand in an hour. The sender treats that as a failure and
  its own delivery record says so.

A visitor's project request from boiseconstruction.co, routed to the remodeling
team:

```json
{
  "brand": "Boise Remodeling Co",
  "name": "Pat Example",
  "email": "pat@example.com",
  "phone": "(208) 555-0142",
  "projectType": "kitchen",
  "address": "123 N Main St",
  "city": "Boise",
  "message": "Project request BCC-4F7K2Q, revision 1, sent from boiseconstruction.co. No price has been given.\nTeam: Boise Remodeling Co. Supporting services: cabinetry, electrical\nPreferred contact: Phone\nWhat they want: A brighter kitchen with an island\nScope: Remove the wall between kitchen and dining. New cabinets, tops and floor.\nFiles attached: 2\nFull request and files (staff sign-in): https://boiseconstruction.co/api/admin/p5-intake?draftId=12345678-1234-4234-8234-123456789abc&revision=1",
  "form": "p5-project-request",
  "request_kind": "quote",
  "contact_preference": "phone",
  "sourceDetail": "p5-project-request:12345678-1234-4234-8234-123456789abc",
  "external_id": "p5-intake-1f0e2ad1c6b1a9f4a7f5f0a6c2f6c3b8d9e4a7b1c0d2e3f4a5b6c7d8e9f0a1b2",
  "utm_source": "google",
  "utm_medium": "cpc",
  "gclid": "abc123",
  "team_alert": "site"
}
```

The estimate the Boise Construction Co team published for it:

```json
{
  "brand": "Boise Construction Co",
  "name": "Pat Example",
  "email": "pat@example.com",
  "phone": "(208) 555-0142",
  "projectType": "kitchen",
  "address": "123 N Main St",
  "city": "Boise",
  "message": "Open the kitchen to the dining room, with new cabinets, countertops and flooring.",
  "form": "p5-estimator",
  "sourceDetail": "p5-estimator:12345678-1234-4234-8234-123456789abc",
  "external_id": "p5-estimator:12345678-1234-4234-8234-123456789abc",
  "request_external_id": "p5-intake-1f0e2ad1c6b1a9f4a7f5f0a6c2f6c3b8d9e4a7b1c0d2e3f4a5b6c7d8e9f0a1b2",
  "team_alert": "site",
  "estimate": {
    "kind": "document",
    "low": 52000,
    "high": 61000,
    "base": 56480.25,
    "label": "Document estimate, kitchen",
    "verified": true,
    "lines": [
      { "title": "Remove the wall between kitchen and dining", "quantity": 1, "unit": "LS", "amount": 9150.75, "division": "Framing" },
      { "title": "Install shaker cabinets, painted", "quantity": 24, "unit": "LF", "amount": 21840, "division": "Cabinets" },
      { "title": "Quartz countertops, eased edge", "quantity": 52.5, "unit": "SF", "amount": 9989.5, "division": "Countertops" },
      { "title": "Luxury vinyl plank flooring", "quantity": 187, "unit": "SF", "amount": 15500, "division": "Flooring" }
    ]
  }
}
```

`base` is the contract price, `low` and `high` the range the customer was
shown, and each `amount` the customer's price for that line; the lines add up
to `base` to the cent. `verified` is `true` because the site's server priced
it. Customer amounts only, as for every `estimate`. When the figures cannot be
used the forwarder sends the lead without `estimate` and without `team_alert`,
so the usual "New lead" email covers it. A synthetic QA record is never
posted.

Guards: `tests/lead-intake-confirm-alert.test.ts` (the intake, with the shared
builders posting into it), `tests/p5-lead-intake.test.ts` (the shared code,
fake fetch), `tests/project-request-lead.test.ts` (p5homeco.com's own path) and
`tests/site-estimate.integration.test.ts` (QuickBooks, needs
`TEST_DATABASE_URL`).
