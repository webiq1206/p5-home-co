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
| Boise Construction Co | `hello@boiseconstruction.co` | Boise Construction Co | Boise Construction Co | Yes (added 2026-08-21) |
| Boise Handyman Co | `hello@boisehandyman.co` | Boise Handyman Co. | Boise Handyman Co. | Yes (added 2026-08-21) |

Recorded in code at `app/lib/leads/settings.ts` (`brandEmailAliases`) and
covered by `tests/aliases.test.ts`.

## Two findings that need action

**1. The remodeling domain in the brief is wrong.** The brief lists
`@boiseremodel.co`. The verified alias is **`hello@boiseremodeling.co`**, which
matches the domain the live website links to. The verified value is what the
code uses.

**2. Two brands had a signature but no address — now fixed.** Gmail held six
signatures, including "Boise Construction Co" and "Boise Handyman Co.", but
only four send-from aliases. Someone prepared those signatures and the aliases
were never added, so those two brands could not send at all.

Both were added on 2026-08-21. Google accepted them **without an emailed
verification code**, because every brand domain is already a verified Workspace
**user-alias domain** of `p5homeco.com` with Gmail activated — so
`hello@boiseconstruction.co` already delivered to this same mailbox.

Each new address was also bound to its own signature under Signature defaults,
for both new mail and replies. Before that binding they were set to "No
signature", which would have sent brand mail unsigned.

The blocking behaviour remains in the code regardless: a brand absent from
`brandEmailAliases` returns null from `sendAsForBrand()` and the send is
stopped rather than falling back to another brand's address.

## Workspace domains

All verified user-alias domains of `p5homeco.com`, Gmail activated:
`boiseadu.co`, `boisecabinet.co`, `boiseconstruction.co`, `boisehandyman.co`,
`boisehomeremodel.co`, `boiseremodeling.co`. Also present:
`outreach.boisecabinet.co` (Gmail not activated).

Note `boisehomeremodel.co` exists as a domain but has no send-from alias and no
brand mapped to it. Worth confirming whether it is intentional or a leftover.

## What was changed, and what was not

**Changed:** two send-from aliases added (`hello@boiseconstruction.co`,
`hello@boisehandyman.co`), and signature defaults bound for those two
addresses.

**Not changed:** no alias was removed or edited, and no routing, existing
signatures, display names, reply-to values, DNS, SPF, DKIM, DMARC, users,
groups, or forwarding were modified.
