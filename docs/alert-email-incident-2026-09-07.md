# Lead alert email containment

Repeated P5 URGENT emails came from the central lead watchdog. Each unresolved
alert could send again every 30 minutes. Separate conditions on one lead had
independent notification timestamps, producing alternating subjects.

The lead escalation email dispatcher now defaults to disabled. Evaluation,
lead capture, HubSpot contact/deal sync, client messages, and finance messages
continue through their existing paths. This requires no database migration.

Only an explicit `P5_LEAD_ALERT_EMAILS_ENABLED=true` enables this dispatcher.
Leave it unset while the HubSpot task lifecycle replaces repeated alerts.

Deployment must sync this reviewed GitHub change into the hosting workspace
without editing application code there, then republish. A saved commit alone
does not stop production emails. Verify the running source and a scheduled
watchdog pass reporting zero escalation emails after deployment.

The next change adds one durable HubSpot task per actionable condition, reads
manager completion before outbound sync, and suppresses resolved conditions.
