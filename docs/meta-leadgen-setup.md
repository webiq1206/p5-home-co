# Meta Instant Form leads, HubSpot sync and lead alerts

How a lead reaches HubSpot, the team email and the HubSpot phone app, and the
exact steps to connect Meta (Facebook and Instagram) Instant Forms to the hub.
Source: `app/api/meta/leadgen/`, `app/lib/integrations/meta-leadgen.ts`,
`app/lib/integrations/hubspot.ts`, `app/lib/leads/leadPipeline.ts`,
`app/lib/notifications/lead-created.ts`, `app/lib/integrations/hubspot-activities.ts`,
`app/lib/integrations/voice-messages.ts`. Schema: `migrations/022_lead_pipeline.sql`
and `023_voice_messages.sql` (additive; applied by the boot migrator,
`npm run db:migrate && npm run start:host`).

## One HubSpot account only

Every write goes to the hello@p5homeco.com account: portal **247066159**
(app-na2), owner **97300513**. Before the first request the hub reads
`/account-info/v3/details` with `HUBSPOT_TOKEN`, caches the answer, and refuses
every HubSpot request unless the portal is 247066159
(`app/lib/integrations/hubspot-portal.ts`). The Timber and Love portal
(**247282537**) is on the same login family and is named in the code as never
used. A refused write is logged (`[hubspot] HUBSPOT_TOKEN belongs to portal ...`),
leaves the deal `failed`, and the watchdog retries it every five minutes, so
fixing the token heals the backlog. `npm run hubspot:setup` refuses another
portal the same way. The inbox sync and the project-review receiver already
verified the portal before this change.

## What happens to every lead

1. The lead is saved in Postgres first (`ingestLead`).
2. **Immediate HubSpot sync**, inline, bounded by `HUBSPOT_INLINE_SYNC_TIMEOUT_MS`
   (default 4000 ms, maximum 15000). The visitor never waits longer than that
   and never sees a HubSpot failure. A short lease on the deal stops the inline
   sync and the watchdog from pushing the same deal at once. Anything not
   finished stays pending and the five-minute watchdog sends it.
3. Contact: matched by stored id, then email, then phone (exactly one match on
   the normalized number, else a new contact). First name, last name, email,
   phone, `address`, `city`, `state`, `zip` are written when the submission
   has them; an empty value is never sent, so nothing in HubSpot is blanked.
4. Owner (`hubspot_owner_id`): the lead's P5 owner (`app_user.hubspot_owner_id`),
   else `HUBSPOT_TASK_OWNER_ID`, else **97300513** (hello@p5homeco.com). Set on
   new contacts and deals, and on an existing contact only when it has no
   owner, so a reassignment made in HubSpot stands. This is what makes the
   free HubSpot mobile app send an "assigned to you" push.
5. A **note** on the contact and the deal with every field the submission
   carried (known fields, custom questions, budget, answers objects, file
   links) and the attribution: source, source detail, form, campaign, UTM
   tags, gclid/gbraid/wbraid, fbclid, landing page, referrer, Meta page, form,
   campaign, ad set and ad ids and names. One note per distinct submission.
6. The **alert email** to hello@p5homeco.com, subject
   `New lead: <Brand> | <Project> | <Name> | <City>`: a large tap-to-call
   button, text and email buttons, the address with a Google Maps link, every
   submitted field, source and ad attribution, links to the HubSpot contact
   (`app-na2.hubspot.com/contacts/247066159/record/0-1/<id>`), the HubSpot deal
   (`.../record/0-3/<id>`) and the P5 admin lead. HTML plus a text part, sent
   through the existing SMTP transport. The text part keeps exactly one
   `Name:`, `Email:` and `Phone:` line, which the inbox sync uses to file the
   email on the right contact when inbox sync is on.

## Meta setup, step by step

The hub endpoint is `https://p5homeco.com/api/meta/leadgen`.

1. **Meta app.** Use the existing **P5 Co** business portfolio and app
   **2915975045410175**. Do not create another app. Add the **Webhooks**
   product if needed. Note the App Secret in App settings, Basic.
2. **Replit secrets** (Deployments, Secrets), then Redeploy after a `git pull`:
   - `META_APP_SECRET`: the App Secret. Every POST is checked against
     `X-Hub-Signature-256` with it. Missing: every delivery gets 503 (Meta
     retries), nothing is accepted unverified.
   - `META_APP_ID`: `2915975045410175` (plain configuration).
   - `META_LEADGEN_VERIFY_TOKEN`: `p5-leadgen-verify-2026` (the owner's shared,
     non-credential handshake string). Missing:
     the subscription handshake gets 503.
   - `META_PAGE_ACCESS_TOKEN`: the existing P5 Co **system-user token**, with
     access to all the intended Pages and `leads_retrieval`. It is used for
     any Page; one token per Page is not required.
   - `META_PAGE_TOKENS` (optional, for more than one Page): JSON
     `{"<page id>": "<page token>", ...}`. Wins over `META_PAGE_ACCESS_TOKEN`
     for the pages it lists.
3. **Webhook subscription.** In the app, Webhooks, choose **Page**, Subscribe
   to this object: callback URL `https://p5homeco.com/api/meta/leadgen`, verify
   token = `META_LEADGEN_VERIFY_TOKEN`. Meta calls GET; the hub echoes the
   challenge. Then subscribe the **leadgen** field.
4. **Permissions** (App Review, or Advanced Access for a business app used by
   its own Page admins): `leads_retrieval`, `pages_manage_metadata`,
   `pages_show_list`, plus `pages_read_engagement` and `ads_management` if
   Meta asks for them to read ad names.
5. **Subscribe the Page to the app**, with a user token that manages the Page:
   `POST https://graph.facebook.com/v21.0/1228704823655951/subscribed_apps?subscribed_fields=leadgen`
   with the Page access token. Confirm with
   `GET /v21.0/1228704823655951/subscribed_apps`.
6. **System-user access.** Assign all intended Page assets to the P5 Co system
   user, and generate its token for the existing app with the required
   permissions. The owner supplies the token and App Secret through secure
   secrets configuration, never through the admin mapping forms.
   `/me/accounts` must actually expose the assigned Pages; an empty list or
   denied request is a setup blocker, not proof that no Pages exist.
7. **Leads Access.** In Meta Business Suite, Settings, Integrations, Leads
   Access, allow the app (CRM access) for the Page.
8. **Test.** Use the Lead Ads Testing Tool
   (developers.facebook.com/tools/lead-ads-testing), pick the Page and a form,
   create a test lead. Expect: a deal with source "Facebook Lead Ad", the
   alert email, a HubSpot contact, deal and note. `meta_leadgen_event` shows
   the delivery and its state.

### What the webhook does

- `GET`: echoes `hub.challenge` only when `hub.mode=subscribe` and
  `hub.verify_token` matches.
- `POST`: signature first (403 when wrong). Every `leadgen` change is saved to
  `meta_leadgen_event` (leadgen_id is the primary key, so a redelivery is a
  no-op) **before** the 200. A failed save answers 500 so Meta redelivers.
- After the response: the lead is read from Graph v21.0 with the Page's token
  in the Authorization header (never the URL), with form, ad, ad set,
  campaign and platform fields.
- Brand: form id (table `META_LEAD_FORMS`, ported from boise-remodeling-co
  PR #138, merged with saved overrides), then Page id, then a campaign named
  `P5 | <Brand> | ...`, else **P5 Home Co**,
  with the form's own name read from Graph and kept as the form.
- Fields: `full_name` (or `first_name`/`last_name`), `email`, `phone_number`,
  `street_address`, `city`, `state`, `zip_code`; every other question is kept
  verbatim in the summary and the submission note. Ingested with source
  "Facebook Lead Ad" and the leadgen id as `external_lead_id` /
  `facebook_lead_id`, then the same inline HubSpot sync and alert email.
- Graph down, token missing or HubSpot slow: the event stays `pending` and the
  watchdog retries it (up to 12 attempts, then `failed`). A lead with neither
  email nor phone is `rejected` and its full Graph record is kept on the row.
- Add a row to `META_LEAD_FORMS` whenever a new brand form is created.
  Alternatively assign the form from the authenticated Meta admin page.

### Multi-page administration and development review

`/admin/lead-manager/meta` requires the existing **administrator** role.
It shows credential presence only, SMTP configuration validity, merged routing
maps and the last 20 operational webhook receipts. It never exposes token
values, raw webhook payloads or raw Graph errors. Stored error text is reduced
to safe categories. Map edits are atomic merges in the existing `setting`
table (`meta_leadgen_routing`), not a new CRM. Existing hard-coded form defaults
remain active unless a saved override replaces an entry. Seed Page routing:

| Page ID | Brand |
|---|---|
| `1228704823655951` | P5 Home Co |
| `1235083469680398` | Boise Cabinet Co |

**Refresh Pages** reads `/me/accounts`, subscriptions and each Page's forms
(including questions). Discovery is explicit rather than a side effect of
viewing the page. Lists paginate by cursor; provider-supplied next URLs are
never followed because they can contain tokens. Discovery has bounded requests
and reports incomplete/denied Pages without claiming success.

**Subscribe all pages** checks the selected app's `leadgen` subscription,
POSTs only where missing, then re-reads it. This changes the live Meta account:
development tests mock it; do not click it against real credentials until
owner review is complete. No campaigns, budgets or HubSpot schemas are changed.

**Run self-test** GETs only this request's own origin at `/api/meta/leadgen`
and verifies the exact echoed challenge. It neither creates a lead nor proves
Meta asset access. It never falls back to a production base URL.

Subscription upkeep runs once per production process boot when configured,
and during the UTC midnight hour through the existing five-minute watchdog
(no new scheduler).
It is **disabled in development and during builds**. Durable claims prevent
duplicate successful nightly runs across restarts; failed nightly runs can retry after
one hour. Missing token/app ID makes it a no-op.

Migration `024_meta_lead_manager.sql` adds only subscription-run history and
HubSpot backoff side tables. Existing `022`/`023` dependencies must also be
present. Migration017 remains deferred; no schema push is needed.

Webhook receipt storage is a single atomic insert before acknowledgement;
Graph retrieval, CRM writes and email happen after the response. The handler
has a 1.75-second response budget. It returns 200 only after durable storage;
on storage failure/timeout it returns 500/503 so Meta retries, rather than
falsely acknowledging and losing leads. A timeout can finish inserting later;
lead-ID dedupe and the watchdog make redelivery safe. This is not an absolute
network-latency guarantee.

HubSpot failures use durable exponential backoff (one minute initially,
capped at six hours), in addition to the existing sync lease and watchdog.
Existing submissions and note dedupe remain intact. New Meta deals use
`<Brand> lead: <First Last>`, the existing New Lead stage
(`appointmentscheduled`), and the configured fallback owner or `97300513`.
Existing pipeline, property definitions, manual proposal fields and existing
record assignments are not reset.

Testing Tool leads intentionally use the **real intake path**, including CRM
creation and alert email when enabled. There is no special dry-run exemption:
use offline mocks for development tests. Real end-to-end verification is a
separate owner-reviewed action after credentials and asset access are verified.

## Calls, texts and notes to HubSpot

Every outcome logged with **Log outcome** in the P5 admin is pushed right away
(bounded, then the watchdog) as an engagement on the contact and the deal:

| P5 activity | HubSpot |
|---|---|
| call outcomes (Connected, Left Voicemail, No Answer, Wrong Number) | CALL, title "Call: outcome", HubSpot's default disposition, note as body |
| Sent Text | COMMUNICATION with channel SMS. If HubSpot refuses that object (400/403/404, nothing created), a NOTE headed "Text message (SMS) sent" |
| any other outcome or note | NOTE headed with the outcome |

Decision on texts: the Communications object is HubSpot's own record for a
logged SMS and is part of the CRM engagements API, so it is used first; the
NOTE fallback means a portal or token without it still keeps the text.
A push whose result is unknown (network or timeout) is marked `uncertain` and
never re-posted; 429/5xx refusals retry up to five times. Only activities
logged after this release are pushed (no backfill).

## Google Voice texts and voicemails

With inbox sync on, Google Voice notification emails are still mirrored as
EMAIL records (the source record, matched to the contact by phone). In
addition each one is logged as:

- text: COMMUNICATION (SMS) on the matched contact, or a NOTE headed
  "Google Voice text message (SMS) from +1..." when the communications object
  is not available (checked before anything is posted);
- voicemail: an inbound CALL "Google Voice voicemail from +1..." with the
  transcript.

Same rule as the Gemini call notes: the attempt is saved before the POST, the
phone must still match the same contact, and an unknown result goes to review.
Real emails keep their EMAIL logging unchanged.

To turn inbox sync on, set in Replit (docs/p5-central-inbox-sync.md):

| Variable | Value |
|---|---|
| `P5_INBOX_SYNC_ENABLED` | `true` |
| `P5_INBOX_SYNC_VERIFIED_BINDING` | `247066159:hello@p5homeco.com` (after the production write check) |
| `P5_INBOX_SYNC_START_AT` | UTC ISO time ending in `Z`, e.g. `2026-11-09T00:00:00Z` |
| `SMTP_USER` | `hello@p5homeco.com` (already set for mail) |
| `SMTP_PASSWORD` | the Gmail app password (already set for mail) |
| `HUBSPOT_TOKEN` | the P5 portal private app token (already set) |

## HubSpot token scopes

The private app token (`HUBSPOT_TOKEN`) needs: `crm.objects.contacts.read/write`,
`crm.objects.deals.read/write` and `crm.schemas.deals.read` (already granted).
HubSpot authorizes notes, calls and communications through the contact and
deal object scopes; verify in the private app before relying on it. If HubSpot
answers 401/403 on a note, the submission falls back to the deal description
and the audit log says so; a refused text becomes a note. The portal guard
reads `/account-info/v3/details`, which any private app token can read.

## Push notifications on your phone

Install the free HubSpot app, sign in as hello@p5homeco.com, and turn on push
notifications for records assigned to you (app Settings, Notifications; on the
web, Settings, General, Notifications). New leads arrive assigned to that
owner unless a P5 user with a mapped `hubspot_owner_id` owns them.
