# Automation rules

Every rule here is deterministic. AI is never asked whether a deadline has
passed; that is arithmetic over stored timestamps, evaluated by
`app/lib/leads/rules.ts`. The same deal evaluated twice always yields the same
answer, which is what makes the watchdog safe to run repeatedly.

## Business calendar

Confirmed with the owner on 2026-08-21.

- **Days:** Monday–Saturday. Sunday is closed.
- **Hours:** 7:00am–6:00pm.
- **Timezone:** America/Boise, DST-correct across both transitions.
- **Holidays:** none configured yet; managed in settings.

All of these are settings, not constants. Nothing reads a hardcoded calendar.

## Response SLA

Target: **first human attempt within 5 business minutes.**

| Elapsed business minutes | Escalation |
| --- | --- |
| 5 | Notify the owner |
| 15 | Notify the owner and the manager |
| 30 | Mark Critical |
| 60 | Notify the designated administrator |

A lead arriving outside business hours is recorded with SLA status
`after_hours`. Its deadline is computed from the next opening, so it is never
born overdue, and it becomes due the moment business hours resume.

## Open-deal rules

Every open deal must have an owner, a valid stage, a next action, and a next
action date. The engine flags: missing owner, missing next action, overdue next
action, an appointment stage with no date, an estimate sent with no follow-up,
decision-pending inactivity, staleness, and Closed Lost with no reason.

## Alert behaviour

Alerts are unique on `(deal_id, kind, tier)` while unresolved, enforced by a
partial unique index rather than application logic — two concurrent watchdog
passes cannot both win. Consequences:

- A repeat pass over unchanged data raises **nothing**.
- Escalating to a higher tier **resolves** the lower tier, so a lead shows one
  current severity instead of a pile of historical ones.
- When the condition clears, the alert resolves automatically.
- After resolution the same alert can be raised again if it recurs.

## Snooze

A snooze requires a reason and a future date. It parks a deal — **except** when
that lead is past its response deadline. A snooze cannot buy out the promise
that somebody replies.

## The watchdog

`POST /api/jobs/watchdog`, authenticated with `WATCHDOG_SECRET` as a bearer
token compared in constant time. It takes a job lock with a four-minute TTL, so
overlapping ticks cannot double-process and a crashed run self-heals by the
next tick rather than wedging the schedule.

Each pass writes a `job_run` row with what it actually processed. A job that
merely ran is not a success.

Schedule it every five minutes:

```bash
curl -fsS -X POST https://YOUR-HOST/api/jobs/watchdog -H "Authorization: Bearer $WATCHDOG_SECRET"
```

## Deferred integrations

Handoff and QuickBooks are filtered out of alerting defensively, in addition to
never producing findings at the source. While their flags are false they make
no requests, run no jobs, raise no alerts, create no tasks, and never appear in
Needs Your Attention.
