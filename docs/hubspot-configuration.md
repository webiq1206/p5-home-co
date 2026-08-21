# HubSpot configuration

**Status: not configured. No changes were made to any HubSpot account.**

Authorization could not be completed in this session, so nothing was inspected,
created, or altered. This file records the intended configuration so it can be
applied in one pass once access exists.

## Intended data model

- **Contacts** for people, **Deals** for individual project opportunities,
  **Companies** only for genuine commercial clients.
- One person may hold several deals. **Brand lives on the deal**, never only on
  the contact — the application already enforces this, and brand is part of the
  duplicate key.
- Reuse HubSpot's default properties before creating custom ones.

## Shared pipeline

One pipeline for all brands, filtered by brand in views:

New Lead → Contacting → Appointment Scheduled → Estimate in Progress →
Estimate Sent → Decision Pending → Closed Won / Closed Lost

## Deal naming

`Last Name | Brand | Project Type | City` — already implemented in
`app/lib/leads/normalize.ts` and covered by tests.

## Property values

**Brand:** P5 Home Co, Boise Construction Co, Boise Remodeling Co,
Boise Handyman Co, Boise ADU Co, Boise Cabinet Co.

**Lead Source:** Facebook Lead Ad, Organic Website, Google Business Profile,
Direct Email, Phone, Referral, Manual Entry, Paid Search, Social Media, Other.

These match `app/lib/leads/types.ts` exactly. Keep them in step; changing a
stored value is a migration, not an edit.

## Handoff and QuickBooks properties

Create them as optional and clearly labelled manual and unverified. They must
stay empty until the corresponding feature flag is enabled.

## Ownership of automation

The P5 rules engine is the automation authority. If any native HubSpot workflow
is retained, it must be documented, made idempotent, and verified unable to
duplicate a P5 task or alert. Two systems creating tasks for the same condition
is the failure this design exists to avoid.

## Open question: licensing

The brief anticipates two HubSpot seats (a lead coordinator, and a manager or
owner) while the admin panel is used by more employees. Whether that is
acceptable under HubSpot's terms needs confirming **before production launch**,
since the panel reads and writes CRM data on behalf of people who do not hold
seats. This is a question for HubSpot, not a technical blocker.

## Service areas

Do not enter service areas until reconciled. `app/site.ts` lists eight cities
(Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell) while the
Google Business Profile appears to list nine. `serviceAreasVerified` is `false`
until the owner confirms.
