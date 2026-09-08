# Release notes, 2026-09-08

## What changed
- Homepage: display-size hero headline restored and no longer overflows on wide screens; "Request a quote" reachable from the header, hero, final CTA, footer and the matcher result; focus rings on every control; mobile menu is a real dialog (focus trap, Escape); icon mark in the header under 560px; phone layout floors removed; footer and index microtype pass AA.
- Quote form: abandonment recovery prompt (call, text, callback) and partial-completion tracking with staff emails (`docs/estimator-recovery.md`); the sweep runs inside the five-minute watchdog. New table `estimator_sessions` (`migrations/013_estimator_sessions.sql`, applied at boot).
- SEO: the seven `/quote/{service}` paid landing variants are `noindex,follow` and out of `sitemap.xml` so they cannot compete with the child sites' service pages; WebPage + FAQPage schema only on the homepage; llms.txt updated; descriptions fitted; `npm test` runs on every build (`prebuild`).
- HTML sitemap page uses site classes and sits below the fixed header.

## Operator steps after deploy
1. Migrations run at boot (`npm run db:migrate`), nothing manual.
2. Partial-completion and callback emails go to active `app_user` rows with the manager or administrator role through the SMTP transport; confirm one of each with a labelled test.
3. Lead escalation emails remain paused unless `P5_LEAD_ALERT_EMAILS_ENABLED=true` (unchanged).
