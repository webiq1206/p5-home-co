# HubSpot lead action tasks

## Status

Implemented and tested in source. Not deployed or enabled in production.
The email incident containment is a separate, already merged change in PR 19.
It needs publishing after the hosting provider's existing database review.

## Behavior

- One task per active actionable condition. Overlapping first-response SLA,
  absolute-ceiling, initial overdue-action and stale-lead alerts share one task.
- Escalation, elapsed time and repeated watchdog passes reuse the incident.
- Tasks belong to the active HubSpot deal owner. Unassigned deals fall back
  to an explicitly configured `HUBSPOT_TASK_OWNER_ID`, or the active owner of
  the verified P5 mailbox. Missing owner access produces a visible sync error.
- Each task links the HubSpot contact and deal and includes the brand, reason,
  due date and a link to the P5 lead. No recurring task or email-reminder field
  is configured. The separate P5 escalation email dispatcher remains off.
- Completing the task acknowledges that issue. It does not invent a call,
  email, first-contact timestamp or successful customer interaction.
- Explicit manager changes to a synced HubSpot deal are read before rule
  evaluation. New first-contact dates, next actions, appointments, ownership
  and closed stages clear their applicable conditions. Pending local human
  changes are preserved, and a revision check protects concurrent edits.
- A later missed commitment with a different deadline, a new unanswered
  customer message, or a condition that clears and later returns can create
  a new incident. Completion does not reopen the same unchanged incident.
- Existing task owner, notes, due dates and in-progress states are preserved.
  When a condition clears in P5, the linked HubSpot task is completed.

## Delivery integrity

A durable database claim precedes task creation. A timeout, lost response,
or server failure does not issue another create request. Subsequent passes
look up the immutable incident subject and recover the existing task. If the
outcome remains uncertain, integration health reports it for review. This
avoids duplicate tasks even while HubSpot search indexing is delayed.

Definitive request rejections can retry after configuration is corrected.
Task and owner queries are read through the existing app token. Default
association definitions are fetched from HubSpot rather than inferred.
Queue selection rotates through incidents, including failed ones, so an old
unresolved issue cannot permanently hide later leads.

The implementation uses the supported [HubSpot task API](https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/tasks/guide).
Production read-only checks on September 7 confirmed access to tasks, owners,
and default task-to-deal and task-to-contact association definitions. A live
task write and completion round-trip have not been performed.

## Required rollout work

1. Apply migration 013 through the normal reviewed deployment workflow.
2. Enable the existing database-backed `hubspotIntegrationEnabled` flag after
   deployment and validate task creation against a legitimate actionable lead.
   The current production token is configured, but the effective flag is off.
3. Connect all child-site lead sources to P5 intake. Source inspection found
   forwarding to separate child dashboards, with no verified bridge to P5's
   `/api/leads/intake`. Production currently contains one P5 deal and zero
   child-brand deals. Supporting all brands in this module is not proof that
   those live websites deliver into this ledger.
4. Verify an actual manager task completion, no recurring task creation, and
   no P5 escalation emails after a scheduled pass. Do not send test emails or
   create fictitious customer activity to satisfy this check.

The child-site relay work, production enablement and live end-to-end checks
remain required. Do not describe this draft as complete coverage of all sites.

## Validation

- 599 ordinary tests passed, including incident grouping and action checks.
- Nine lifecycle integration scenarios passed against an isolated PostgreSQL
  engine (PGlite), with every HubSpot request intercepted. They cover repeated
  passes, completion, new commitments, closed deals, lost responses, definitive
  rejections, all five brand payloads, concurrent creation and inbound actions.
- Twelve existing watchdog integration tests passed with the new schema.
- ESLint and the production build passed.
- No production database writes, test leads, CRM tasks or emails were sent.

The normal test command skips database suites without `TEST_DATABASE_URL`.
The isolated test runtime was outside the repository and added no application
dependency. PGlite validates PostgreSQL execution, not provider delivery or the
host's production database permissions and latency.
