# HubSpot configuration

**Portal 247066159** (`app-na2.hubspot.com`). Configured through the browser on
2026-08-21.

## Plan and limits — read this before planning anything else

The portal is on the **free tier**, and three limits shape the whole design:

| Limit | Value | Consequence |
| --- | --- | --- |
| Users | **2 seats** (1 used) | Employees use the P5 admin panel, not HubSpot |
| Deal pipelines | **1 of 1 used** | One shared pipeline for all brands — which is the intended design anyway |
| Booking pages | **1, already used** | Cannot create more scheduling links without upgrading |

The seat limit is exactly why the admin panel owns employee access while
HubSpot holds CRM data. **Confirm with HubSpot that this is acceptable under
their terms before production launch**, since the panel reads and writes CRM
data on behalf of people who do not hold seats.

## Existing users

One active user: **Client Services `hello@p5homeco.com`**, Super Admin, created
2026-08-16. This is the same mailbox that owns the Gmail aliases.

## Changes made

| Setting | Was | Now |
| --- | --- | --- |
| Time zone | UTC-04:00 Eastern | **UTC-06:00 Boise** |
| Company name | *(empty)* | P5 Home Co |
| Industry | Real Estate | Construction |

The timezone change was confirmed through HubSpot's warning dialog. It affects
how reports are calculated; with **0 deals** in the portal at the time, there
was no historical reporting to distort. Account name (`P5 Home Co`) and company
domain (`p5homeco.com`) were already correct and were left alone.

## Deal pipeline

The default "Sales Pipeline" (internal id `default`) was reconfigured in place
to the P5 stages. All stages had 0 deals, so nothing was migrated or lost.

| # | Stage | Internal stage ID | Probability |
| --- | --- | --- | --- |
| 1 | New Lead | `appointmentscheduled` | 20% |
| 2 | Contacting | `qualifiedtobuy` | 40% |
| 3 | Appointment Scheduled | `presentationscheduled` | 60% |
| 4 | Estimate in Progress | `decisionmakerboughtin` | 80% |
| 5 | Estimate Sent | `contractsent` | 90% |
| 6 | Decision Pending | `4182226638` | 20% |
| 7 | Closed Won | `closedwon` | Won (100%) |
| 8 | Closed Lost | `closedlost` | Lost (0%) |

**The internal stage IDs do not match the visible labels.** HubSpot keeps the
original id when a default stage is renamed, so "New Lead" is stored as
`appointmentscheduled`. This is invisible to users but matters a great deal to
code: **any integration must map by stage ID, never by label**, and must use
this table rather than inferring the id from the name.

`Decision Pending` is the one genuinely new stage and carries a numeric id. Its
probability is still the 20% default and should be raised to roughly 90% before
forecasting is used, since it sits between Estimate Sent and Closed Won.

## Existing contacts — a real data-quality problem

The portal holds roughly 16 contacts, all owned by Client Services and all
created by Gmail sync from `hello@p5homeco.com`. They are **vendors and SaaS
senders, not leads**: Google, Houzz, Yelp, Ahrefs, Resend, HubSpot onboarding,
plus a few genuine business contacts.

Under Contacts → Setup, **"Assign unowned contacts to email sender" is on**,
which is how routine correspondence became CRM contacts.

This is precisely the failure the intake design guards against: the lead
manager creates a contact only for a submission that qualifies as a lead, and
sends anything uncertain to a review queue. No cleanup of these existing
records was performed — deleting CRM data needs your explicit approval.

## Scheduling page

**Live at `https://meetings-na2.hubspot.com/client3`** and verified working.

Two separate links were requested — a 15-minute Discovery Call and a 1-hour
Project Walk — but the free tier allows only **one** booking page and it was
already used. The create form loads with its fields `readOnly`, so this is a
hard paywall, not a UI problem. Rather than buy an upgrade, the single free
page was rebuilt to serve both purposes:

| Setting | Was | Now |
| --- | --- | --- |
| Scheduling title | Meet with Client Services | **Meet with P5 Home Co** |
| Internal name | 60 min, 30 min, and 15 min meeting | P5 Home Co - Discovery Call or Project Walk |
| Durations | 15 / 30 / 60 min | **15 min and 1 hr** (30 removed) |
| Organizer time zone | **UTC-04:00 Eastern** | **UTC-06:00 Mountain** |
| Availability | Mon–Fri, 9:00am–5:00pm | **Mon–Fri and Saturday, 7:00am–6:00pm** |

The description tells the visitor which to pick: 15 minutes for a Discovery
Call, 60 minutes for an on-site Project Walk.

Two of those were outright bugs rather than preferences. The organizer time
zone was Eastern, which offsets every advertised slot by two hours against
actual Boise availability. And the window was Mon–Fri 9–5, which both closed
Saturday — a working day for this business — and mismatched the confirmed
7:00am–6:00pm hours.

Verified on the live public page: Saturday 2026-08-22 offers slots from
**7:00 am Mountain**, Sundays are closed, and only 15-minute and 1-hour options
appear. Google Calendar is connected for `hello@p5homeco.com`.

If two genuinely separate URLs are wanted later, that needs Starter Customer
Platform — a purchase, and your decision.

## Deal properties — created

28 custom properties created via `npm run hubspot:setup`, all in the
**P5 Lead Manager** group, verified present in HubSpot. Re-running the script
skips all 28, so it is safe to run again.

Eight HubSpot defaults are **reused rather than duplicated**, and the script
prints whether each was found: `dealname`, `amount`, `dealstage`, `pipeline`,
`closedate`, `hubspot_owner_id`, `description`, `closed_lost_reason`.

Enumerations mirror `app/lib/leads/types.ts` exactly, verified after creation:

- **p5_brand** — the six brands
- **p5_lead_source** — the ten sources
- **p5_project_type** — the twenty project types
- **p5_sla_status** — On track, Due soon, Breached, Met, After hours, Not applicable
- **p5_service_area** — the eight approved cities

Datetime properties (`p5_sla_deadline`, `p5_first_attempt_at`,
`p5_first_two_way_at`, `p5_next_action_at`, `p5_appointment_at`) take epoch
milliseconds. Handoff and proposal fields are labelled "(manual)" and described
as MANUAL AND UNVERIFIED, because nothing validates them while that
integration is off.

## API access

A **Service Key** named "P5 Lead Manager" provides API access, with seven
least-privilege scopes: `crm.objects.{contacts,deals}.read/write`,
`crm.objects.owners.read`, `crm.schemas.deals.read/write`. The sensitive and
highly-sensitive variants were deliberately not granted.

HubSpot now steers new integrations to Service Keys rather than legacy private
apps, which "won't receive new API scopes or features", so the supported path
was taken.

The token lives in `.env.local` locally and must also be set as `HUBSPOT_TOKEN`
in Replit Secrets for the deployed app. It is not in source control.

## Still to do

- **Saved views and the dashboard.** There is no public API for CRM index saved
  views, so these are UI work. `/crm/v3/lists/search` exists but Lists are a
  different feature and need `crm.lists.read`, which was not granted.
- Service areas — still 8 confirmed on the website versus 9 implied by the
  Google Business Profile
- Contact-side properties, if inbound email classification needs them
