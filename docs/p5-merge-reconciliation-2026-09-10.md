# P5 merge reconciliation, September 10, 2026

The user authorized committing, pushing, and merging the outstanding site updates into main. This integration preserves the unified 20% overhead estimator implementation already merged today and incorporates the newer visual review snapshot.

## Source reconciliation

- Estimator policy and workflow changes are retained from main, including saved-draft recovery, separate delivery states, and the Construction optional-address fix where applicable.
- The September 9 visual-polish draft is superseded by the later verified slider, navigation, CTA, typography, and representative-imagery fixes. Its history is incorporated without restoring obsolete assets, stale route inventories, or older overlapping component implementations. See `docs/p5-visual-audit-2026-09-09.md` for that prior release's coverage.
- Sitemap-dates branches use the same recorded modification-date behavior already on main. Existing behavior is retained.
- New visual review snapshot: `5abf290303b7dd64bacd648a54f345a1094b060e`. Concurrent edits made after this snapshot remain on their source branch until reviewed; this integration does not alter another working directory.
- Temporary component fixtures put the client directive and React hook imports before rendering. A failed build no longer produces misleading form-check connection failures.
- Estimator verification now also runs on main, and both estimator and component verification run on the integration branch.

## Remaining operational limits

Git merging is not proof of public deployment. Existing legacy-estimator pricing migration, production cost-book configuration, live provider/CRM delivery, authenticated operational trials, and physical-device verification remain subject to the previously documented audit limits. Automated browser emulation does not certify every page on physical hardware.

## P5 lead and paid-search updates

Retains the current menu and responsive call-bar behavior while centralizing safely serialized page-specific structured data and tracked phone links. HubSpot incidents/tasks and pull-before-watchdog reconciliation are combined with existing abandoned-session recovery. New lifecycle verification uses isolated PostgreSQL and intercepted HubSpot transports; it sends no live messages. Migration 013 remains part of the normal application deployment process.
