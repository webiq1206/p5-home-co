# Email delivery: p5homeco.com

## Sending configuration

Use Google Workspace SMTP with server-only SMTP_USER and SMTP_PASSWORD. SMTP_FROM defaults to P5 Home Co <hello@p5homeco.com> and must remain one p5homeco.com mailbox. Port 465 uses implicit TLS; other ports require STARTTLS. Both delivery paths use the same configuration and reject partial acceptance. Logging without credentials is not a successful send.

Never use a visitor's address as From. Credentials must not use NEXT_PUBLIC_ variables. Provider acceptance means accepted for processing, not delivered or placed in an inbox.

## DNS and operational checks

Run `node scripts/email-dns-health.mjs`. It checks public DNS without changing records or sending mail. Missing records and failed lookups produce a nonzero exit; a lookup failure is UNKNOWN, not a confirmed missing record.

Workspace SPF is one TXT at @: `v=spf1 include:_spf.google.com ~all`. Google DKIM uses google._domainkey and must also be activated in Google Admin.


The September 19, 2026 repairs were verified publicly and all five Workspace domains showed DKIM authenticating. DMARC remains p=none with aggregate reporting. Child domains report to their corresponding hello@ aliases, which route to the central P5 mailbox without cross-domain reporting authorization.

Before quarantine: account for every legitimate sender, complete DNS/account repairs, inspect fresh externally received Workspace and actual website emails for all five domains, and review at least seven representative clean reporting days. Missing reports or low volume are not proof of success. Before reject: review approximately another month of clean reporting after quarantine. Retain the working monitoring records for rollback. Never advance policy just because time has elapsed.

## Deployment and received-message tests

Publish the reviewed Git changes, then pull and republish in the existing Replit deployment. Confirm the deployed version and sender environment settings. Send one clearly labeled test from each Workspace identity and submit a test through each real site form to a controlled external mailbox. Record provider ID, From, Return-Path, receiver Authentication-Results (SPF/DKIM/DMARC and alignment), and inbox/spam placement separately. Do not count a Sent-folder copy as receiver evidence.

For commercial outreach, use an owned verified outreach subdomain, an accurate full postal address, a usable plain-text unsubscribe URL, one-click unsubscribe where applicable, and bounce/complaint suppression. A subdomain does not guarantee isolation from the parent domain's reputation. Avoid shortened links and first-contact attachments. Increase volume only among recipients who expect the mail.



Google Postmaster registration is a separate remaining account step. A dashboard with no data does not establish successful delivery.

References: [Google sender guidelines](https://support.google.com/a/answer/81126), [Google DKIM](https://support.google.com/a/answer/174124), [Resend domains](https://resend.com/docs/dashboard/domains/introduction).
