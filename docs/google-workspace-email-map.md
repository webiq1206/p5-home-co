# Google Workspace email map

**Status: not established. Deliberately empty.**

## What this file is for

A verified mapping from each P5 brand to the exact send-from address, display
name, reply-to address, and signature it uses, plus whether each address is a
true alias, a group, a routed address, or a separate mailbox.

## Why it is empty

The brief is explicit that this must be built from verified configuration and
not guessed. The verification was attempted and failed on access, not on
effort: the reachable Gmail account is `jb@timberandlove.com`, not
`hello@p5homeco.com`.

Recording a plausible-looking map here would be worse than recording nothing.
Every outbound email decision reads from it, so a wrong row means a client
receives mail from the wrong company.

## Candidate domains, unverified

From the brief, pending confirmation against actual Workspace configuration:

| Brand | Expected domain | Verified? |
| --- | --- | --- |
| P5 Home Co | `@p5homeco.com` | No |
| Boise Construction Co | `@boiseconstruction.co` | No |
| Boise Remodeling Co | `@boiseremodel.co` **or** `@boiseremodeling.co` | No — the brief and the live site disagree |
| Boise Handyman Co | `@boisehandyman.co` | No |
| Boise ADU Co | `@boiseadu.co` | No — domain does not resolve yet |
| Boise Cabinet Co | `@boisecabinet.co` | No |

Note the remodeling discrepancy: the brief lists `boiseremodel.co` while
`app/site.ts` links to `https://boiseremodeling.co`. Confirm which is correct
before either is used to send mail.

## How the application behaves meanwhile

`settings.brandEmailAliases` is empty. Any send path must treat a missing alias
as a hard stop and surface a clear administrator action. It must never fall
back to another brand's address.

## To unblock

1. Grant access to the `hello@p5homeco.com` Workspace account.
2. Inventory each address: send-from, domain, display name, reply-to,
   signature, verification status, and whether it is an alias, group, routed
   address, or mailbox.
3. Confirm which addresses actually deliver into the central inbox.
4. Record the verified result in this file and in settings.

Existing configuration must be preserved. No aliases, routing, signatures,
display names, DNS, SPF, DKIM, DMARC, users, groups, or forwarding were changed.
