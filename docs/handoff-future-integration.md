# Handoff: future integration

**Handoff is not connected, and was not touched during this project.**

No login, no OAuth request, no API credentials, no Zapier wiring, no data sent,
and no existing Handoff or Handoff-to-QuickBooks configuration inspected or
changed.

## The flag

`settings.featureFlags.handoffIntegrationEnabled` — defaults to **false**.

While false, the system makes no Handoff API requests, requests no credentials,
runs no Handoff jobs, and claims no synchronization. Administrators see
Handoff as **Planned**, never as Failed. Its disconnected state does not
increase alert counts, trigger notifications, create tasks, appear in Needs
Your Attention, fail a deployment, or fail a test. This is verified by test.

## What exists now

The `deal` table carries optional columns, all null and all labelled manual:

`handoff_client_id`, `handoff_project_id`, `handoff_project_url`,
`handoff_status`, `proposal_status`, `proposal_sent_at`,
`proposal_approved_at`, `estimate_amount`, and the flag
`handoff_values_are_manual` (default true).

An employee with permission may record a Handoff link or status by hand. The UI
labels those values **Manual** and **Unverified**, because nothing has confirmed
them against Handoff.

## Intended workflow, once enabled

1. A qualified deal reaches Estimate in Progress.
2. The employee selects Create Bid.
3. Existing Handoff records are checked first.
4. Client and project are created or matched.
5. Handoff ids are stored on the deal.
6. An estimator is assigned.
7. Bid status appears in P5.
8. Proposal events update HubSpot.
9. Duplicates are prevented by the stored ids.

## Intended stage mapping, not active

| Handoff | P5 stage |
| --- | --- |
| Draft | Estimate in Progress |
| Bidding | Estimate Sent |
| Approved | Closed Won — **only after verified confirmation** |
| In Progress / Completed | post-sale status, not a pipeline stage |

Approved must never move a deal to Closed Won automatically without
confirmation. Marking work won that was not won corrupts every downstream
number.

## Boundary

Estimating is isolated behind the deal's Handoff columns and the flag. Nothing
in intake, the rules engine, or the watchdog knows Handoff exists, so it can be
connected later without touching the lead system.

The intended financial architecture is **Handoff → QuickBooks**. Do not build a
competing HubSpot-to-QuickBooks sync.
