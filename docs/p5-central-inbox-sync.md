# P5 central inbox reconciliation

This worker is **disabled by default**. Its presence does not mean email capture
is activated or that HubSpot EMAIL permissions have been granted. It adds no
public endpoint, scheduler, notification sender, deal, project, or campaign.
The existing watchdog invokes it after its existing notification work, only
when `P5_INBOX_SYNC_ENABLED=true`.

## Current activation blockers

On October 8, 2026, the existing P5 Gmail SMTP credential authenticated a
read-only IMAP session for `hello@p5homeco.com` in the workspace. Production
credential binding and production access were not proved by that check.
The existing HubSpot service key belongs to portal **247066159**, app/key
**50054898**, P5 Lead Manager. Its EMAIL read returned **403 MISSING_SCOPES**.
The observed seven grants cover contacts, deals, owners and deal schema, but
not email content. No permission is changed by this code.

Official legacy v3 documentation requires contact read/write for the contact
and EMAIL operations and additionally documents `sales-email-read` for email
engagement content. The observed service-key picker offers `sales-email-read`;
the runtime error also lists granular email-read alternatives that were not
available in that picker. Do not infer write readiness solely from a read
request, or add unneeded permissions. Grant changes require the operator's
separate authorization and an actual authorized diagnostic create/readback.

Before activation, verify all of the following in the actual production
deployment: the existing Gmail identity and read-only IMAP access; the same
database's additive migration; the current token's portal, EMAIL list/search,
owner and association reads; and a controlled EMAIL create/readback with the
expected customer association. Keep the feature off until these checks pass.

Only then set these **server-only** values:

| Variable | Meaning |
| --- | --- |
| `P5_INBOX_SYNC_ENABLED` | Must be exactly `true`; otherwise no mailbox, HubSpot or database operation occurs. |
| `P5_INBOX_SYNC_VERIFIED_BINDING` | Must be exactly `247066159:hello@p5homeco.com`, an operator attestation of the completed production and write checks. This is not a credential and does not replace live preflight. |
| `P5_INBOX_SYNC_START_AT` | Explicit UTC ISO timestamp ending in `Z`. Choose the approved cutover after historical recovery. No implicit all-time backfill. |

The existing `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_HOST` and `HUBSPOT_TOKEN` are
used in place. They are never copied, emitted, placed in URLs, or written to
receipt records. Only the Gmail SMTP host and exact central mailbox are
accepted. The IMAP destination is fixed to `imap.gmail.com:993` with verified
TLS. No OAuth sign-in, credential creation, or permission expansion occurs.

## Capture and identity behavior

Each pass first requires the public `GET /account-info/v3/details` to identify
portal 247066159, then checks EMAIL content/search, the configured P5 owner,
contact read and EMAIL-to-contact association type 198. Any 401/403 stops the
pass. It does not switch to a different email endpoint to evade permission
checks. Legacy private-app introspection is not required for this service key.

The worker obtains folder paths from actual LIST SPECIAL-USE/XLIST flags.
It requires exactly one selectable All Mail, Junk and Trash folder; guessed
English names are rejected. Every folder lock is read-only (EXAMINE). Only
UID search/fetch, LIST, connection and logout operations are used. No message
flag, label, deletion, move, send or subscription operation is present.

Gmail's decimal X-GM-MSGID remains a string. Each source also retains folder,
UIDVALIDITY and UID. A UIDVALIDITY rollover creates a new cursor namespace;
the Gmail source identity prevents a second local receipt. Source insertion
and checkpoint advancement are one transaction. Parser failures, large
messages and duplicate RFC IDs are saved as explicit review receipts, allowing
later messages to proceed. Original observed labels remain recorded, including
Spam/Trash. Spam/Trash messages are held for review and never relabeled.

| Source | Customer association |
| --- | --- |
| Authenticated P5 brand notification with a supported consultation/lead/project-review subject | Parse explicit `Name:`, `Email:` and `Phone:` field lines. Multiple field lines anywhere in the body are ambiguous, preventing multiline-name/section injection. Only one unambiguous external customer email may create a contact. A phone-only submission can match an existing exact contact; it cannot create one. |
| Authenticated Google Voice SMS or voicemail notice | Extract caller phone from the subject/relay, reject conflicting callback numbers, then compare the complete normalized number with existing CRM candidates. No contact is created from a Voice relay, notification sender, phone number or guessed name. |
| Other non-bulk external correspondence | Match an existing contact by exact primary/secondary email. Unknown senders are saved as unassociated EMAIL activities; this worker does not create contacts for them. |
| Ambiguous customer identity | Preserve the activity unassociated. Do not invent identities, contact details or relationships. |
| Existing native or previously recovered RFC message | Full-read original metadata/body and verify the customer association. Preserve the EMAIL without mutation. Wrong or unverifiable customer links become review receipts. |

The native HubSpot Gmail connection, aliases, logging rule and optional beta
remain unchanged. If native new-contact logging is enabled later, it may
create notifier/relay contacts; a matching RFC ID alone never proves correct
customer association.

## Delivery receipts and limits

Migration `018_inbox_sync.sql` creates only the receipt and cursor tables.
It does not alter or delete existing data. Apply it through the existing
reviewed migration workflow before enabling the worker; the worker does not
provision schema at runtime.

Two hours are allowed for native logging before processing a newly captured
receipt. The worker searches the exact RFC Message-ID and reads the complete
result, then checks again immediately before creation. A unique local RFC key,
atomic claim, expiring lease and persisted create intent guard concurrent or
interrupted workers. Newly observed Spam/Trash labels revoke a pending claim.

No EMAIL POST is automatically retried. A timeout, lost response or ambiguous
server failure after the create intent enters reconciliation. A known returned
ID is saved before readback. Without a returned ID, later searches may adopt
the existing activity, but a negative result never authorizes another POST.
An observed existing EMAIL ID is saved before customer lookup, with a distinct
existing-record origin. Retries read that immutable ID and cannot forget the
earlier positive evidence or create again because a later search is negative.
Search is eventually consistent and excludes archived records, so an unresolved
create requires operator review instead of risking a duplicate. The two-hour
grace period reduces races with native logging; it cannot provide an atomic
uniqueness guarantee across two independent writers.

Decoded original plaintext and HTML are kept separately without generating
one from the other or rewriting CID links. New EMAILs preserve the complete
sender/recipient display names in header JSON. A clearly separated source
footer follows the intact original text/HTML, with the Gmail message link
bound to the central mailbox, original Date header, parsed sent date, received
timestamp, RFC Message-ID and attachment names/sizes. The Gmail link uses the
exact decimal X-GM-MSGID converted with BigInt to hexadecimal, without numeric
precision loss. Original header lines and observed labels are retained locally.
The original Gmail source remains authoritative. HubSpot may sanitize HTML;
readback therefore compares normalized visible text and original link/image
targets, conservatively holding missing/truncated/unverifiable HTML. It does
not merely check that HTML is nonempty or claim byte-identical rendering.
The worker does not upload attachment binaries or transcribe/play Voice audio;
the footer points to the original Gmail message for original attachment access.

Messages above **10 MiB of MIME source** are held with original envelope and
source location metadata. Their bodies/attachments remain in Gmail and are
not represented as imported. This includes messages with large plan PDFs.
Missing RFC IDs, unsafe or absent body content, unsupported notifier templates,
ambiguous matches and unexpected automatic CRM associations also have explicit
hold/ignore reasons. Newsletter/list mail, drafts, most automated senders and
unsupported internal/outgoing templates are outside this narrow worker's scope.

HTTP calls have deadlines and pacing; IMAP, pool acquisition and inbox SQL
queries have timeouts. Each pass targets a 90-second processing budget, fetches
at most 20 messages per folder and processes at most 10 due receipts. Rotating
the first folder prevents a large archive from permanently starving Junk or
Trash. Bounded cleanup/database operations can extend the nominal budget.
The watchdog starts this optional tail step only when at least two minutes
remain in its existing four-minute lease; a slow core pass defers inbox work.
The separate `hubspot-inbox` integration-health row reports permission failures
and a degraded state when receipts require review/reconciliation. It never
changes the existing lead/task result counters or triggers outreach.

## Verification

Synthetic tests exercise default-off and foreign-account refusal, EMAIL403
failure without fallback, original MIME body preservation, website injection,
Voice identity rules, atomic checkpoints, UIDVALIDITY rollover, duplicate RFC
sources, stale claims after Spam classification, uncertain creates, provider-ID
recovery, and existing native records with incorrect contact associations.
They also cover preserved names and source links, attachment references,
64-bit Gmail IDs, sanitized HTML verification and truncated/changed content.
The IMAP adapter test uses a fake read-only client, not a live mailbox.

Relevant official references:

- [HubSpot email activities](https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/emails/guide)
- [HubSpot scopes](https://developers.hubspot.com/docs/apps/legacy-apps/authentication/scopes)
- [HubSpot account details](https://developers.hubspot.com/docs/api-reference/legacy/account/account-information/get-account-details)
- [HubSpot search behavior](https://developers.hubspot.com/docs/api-reference/legacy/crm/search-the-crm)
- [Google Gmail IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)
- [Google Workspace IMAP and app passwords](https://knowledge.workspace.google.com/admin/sync/set-up-gmail-with-a-third-party-email-client)
- [ImapFlow client](https://imapflow.com/docs/api/imapflow-client/)
- [MailParser](https://nodemailer.com/extras/mailparser)
