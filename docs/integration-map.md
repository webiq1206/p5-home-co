# Integration map

Verified status as of 2026-08-21. Nothing below is assumed; each line reflects
something checked directly.

| System | Status | Detail |
| --- | --- | --- |
| **Website intake** | Connected | `POST /api/leads/intake`, verified end to end |
| **PostgreSQL** | Connected | Replit "Development Database", 20GB. No production database exists yet. |
| **Watchdog** | Built, unscheduled | Autoscale cannot run it; needs an external scheduler |
| **Meta / Facebook** | Located, not wired | Ad account `956415147420695` ("P5 Home Co") under business `2628466967549947` ("P5 Co"), ACTIVE and queryable. Lead forms are not mapped to brands. |
| **HubSpot** | Not connected | No authorized session available. Nothing was created or changed. |
| **Gmail** | Blocked | The connected mailbox is `jb@timberandlove.com`, not `hello@p5homeco.com`. |
| **Handoff** | Planned | Deliberately disconnected. `handoffIntegrationEnabled = false`. |
| **QuickBooks** | Planned | Deliberately disconnected. `quickBooksIntegrationEnabled = false`. |

## Gmail: why this is blocked

The brief names `hello@p5homeco.com` as the central mailbox. The Gmail account
actually reachable in this session is `jb@timberandlove.com` — a different
business. Searching the entire mailbox for `hello@p5homeco.com` returns a
single message, from July 2026, where the address was merely CC'd.

Nothing was inventoried, mapped, or sent on that basis. Using that mailbox as
the P5 lead inbox would pull an unrelated business's correspondence into the
CRM, and would risk sending to clients from the wrong identity.

The brand-to-alias map is therefore **empty**, not guessed. `brandEmailAliases`
in settings starts empty on purpose: sending as the wrong brand is worse than
not sending, so an unverified alias blocks the send rather than falling back.

To unblock: grant access to the `hello@p5homeco.com` Workspace account, then
the real send-from addresses, display names, reply-to values, signatures, and
verification status can be inventoried and recorded in
`docs/google-workspace-email-map.md`.

## HubSpot: why this is blocked

The HubSpot connector requires an OAuth authorization that cannot be completed
in a non-interactive session. No portal access was available by any other
route. No properties, pipelines, views, dashboards, or private apps were
created, and no existing configuration was inspected or altered.

The data model is nonetheless ready for it: `deal` and `contact` carry
`hubspot_*` id columns, and `integration_sync_status` / `last_integration_error`
exist for the sync path.

## Facebook: what remains

The correct ad account was located and confirmed active. What is outstanding is
the part that needs decisions rather than access: which Pages and lead forms
are live, and which P5 brand each form maps to. `external_lead_id` is already
the idempotency key, so a form's leads can be imported without duplicates once
the mapping exists.
