# Google Workspace email map

**Status: verified 2026-08-21 against the live `hello@p5homeco.com` account.**

## The account

`hello@p5homeco.com` — display name **Client Services**, Workspace mailbox
"P5 Home Co Mail". This is the central inbox and the default send-from address.

**Reply behaviour: "Reply from the same address the message was sent to"** is
selected. This is the correct setting and must not be changed — it is what
keeps a reply on a brand thread going out as that brand.

## Verified send-from aliases

All four are verified in Gmail (each offers "make default", none is flagged
unverified).

| Brand | Send-from address | Display name | Signature | Alias exists |
| --- | --- | --- | --- | --- |
| P5 Home Co | `hello@p5homeco.com` | Client Services | P5 Home Co | Yes (default) |
| Boise ADU Co | `hello@boiseadu.co` | Boise ADU Co. | Boise ADU Co. | Yes |
| Boise Cabinet Co | `hello@boisecabinet.co` | Boise Cabinet Co. | Boise Cabinet Co. | Yes |
| Boise Remodeling Co | `hello@boiseremodeling.co` | Boise Remodeling Co. | Boise Remodeling Co. | Yes |
| **Boise Construction Co** | **none** | — | Boise Construction Co | **No** |
| **Boise Handyman Co** | **none** | — | Boise Handyman Co. | **No** |

Recorded in code at `app/lib/leads/settings.ts` (`brandEmailAliases`) and
covered by `tests/aliases.test.ts`.

## Two findings that need action

**1. The remodeling domain in the brief is wrong.** The brief lists
`@boiseremodel.co`. The verified alias is **`hello@boiseremodeling.co`**, which
matches the domain the live website links to. The verified value is what the
code uses.

**2. Two brands have a signature but no address.** Gmail holds six signatures —
including "Boise Construction Co" and "Boise Handyman Co." — but only four
send-from aliases exist. Someone prepared those signatures and the aliases were
never added.

Until an alias exists for `boiseconstruction.co` and `boisehandyman.co`, the
system **cannot send as those two brands**, and `sendAsForBrand()` returns null
so the send is blocked with an administrator action. That is deliberate:
mailing a construction client from `hello@p5homeco.com` misrepresents which
company they are dealing with, and an unverified sender is likely to be
rejected or treated as spoofed.

To fix, in Gmail → Settings → Accounts → "Send mail as" → Add another email
address, for each of the two brands, then complete Google's verification. Once
verified, add them to `brandEmailAliases`.

## What was not changed

No aliases were added, removed, or edited. No routing, signatures, display
names, reply-to values, DNS, SPF, DKIM, DMARC, users, groups, or forwarding
were modified. The inventory was read-only.
