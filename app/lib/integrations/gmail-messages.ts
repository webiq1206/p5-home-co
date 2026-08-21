/**
 * Reading a mailbox well enough to know who is waiting on whom.
 *
 * Pure, because these judgements decide whether the system nags people over
 * nothing or misses a customer who has been ignored for a day. Neither is
 * recoverable by tuning a threshold later.
 */

/** The parts of a Gmail message this needs. */
export type RawMessage = {
  id: string;
  threadId: string;
  /** Header values, lowercased keys. */
  headers: Record<string, string>;
  /** Gmail's own labels, e.g. SENT, INBOX, SPAM, CATEGORY_PROMOTIONS. */
  labelIds: string[];
  internalDate: string;
  snippet: string;
};

export type Direction = "inbound" | "outbound";

export type ParsedMessage = {
  messageId: string;
  threadId: string;
  direction: Direction;
  /** The other party's address: who wrote in, or who we wrote to. */
  counterpartyEmail: string | null;
  /** The P5 address involved, which tells us the brand. */
  ourAddress: string | null;
  subject: string;
  occurredAt: Date;
  snippet: string;
};

/** Extract a bare address from a header like `Jane Doe <jane@example.com>`. */
export function addressFrom(header: string | undefined): string | null {
  if (!header) return null;
  const angled = /<([^>]+)>/.exec(header);
  const candidate = (angled ? angled[1] : header).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Every address in a header that may list several. */
export function addressesFrom(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => addressFrom(part))
    .filter((a): a is string => a !== null);
}

/**
 * Whether an address belongs to us.
 *
 * Compared on domain, so any address at a P5 brand domain counts, including
 * aliases and people who are not in app_user.
 */
export function isOurAddress(email: string, ourDomains: readonly string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  return ourDomains.includes(email.slice(at + 1).toLowerCase());
}

/**
 * Messages that must never start a lead clock.
 *
 * Gmail's own categories catch most of it. Automated senders are matched on
 * the local part, because a bounce or an out-of-office reply is not a customer
 * waiting for an answer -- treating one as such would have someone chasing a
 * mail server.
 */
const IGNORED_LABELS = ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const AUTOMATED_LOCAL_PARTS = [
  "no-reply", "noreply", "donotreply", "do-not-reply", "mailer-daemon",
  "postmaster", "bounce", "bounces", "notifications", "notification",
  "automated", "auto-confirm", "support",
];

export function isIgnorable(message: RawMessage): { ignore: boolean; because?: string } {
  for (const label of IGNORED_LABELS) {
    if (message.labelIds.includes(label)) {
      return { ignore: true, because: `label ${label}` };
    }
  }

  // Auto-replies announce themselves. Honouring that keeps an out-of-office
  // from reading as a customer reply.
  const auto = message.headers["auto-submitted"];
  if (auto && auto.toLowerCase() !== "no") return { ignore: true, because: "auto-submitted" };
  if (message.headers["x-autoreply"] || message.headers["x-autorespond"]) {
    return { ignore: true, because: "auto-reply" };
  }
  if (message.headers["list-unsubscribe"]) {
    return { ignore: true, because: "bulk mail" };
  }

  const from = addressFrom(message.headers.from);
  if (from) {
    const local = from.slice(0, from.lastIndexOf("@"));
    if (AUTOMATED_LOCAL_PARTS.some((p) => local === p || local.startsWith(`${p}+`) || local.startsWith(`${p}-`))) {
      return { ignore: true, because: `automated sender (${local})` };
    }
  }

  return { ignore: false };
}

/**
 * Turn a raw message into the facts the rules engine needs.
 *
 * Direction comes from who sent it rather than Gmail's SENT label, because a
 * message can carry SENT while still being a reply in a thread we did not
 * start, and the sender is the thing that is actually true.
 */
export function parseMessage(
  message: RawMessage,
  ourDomains: readonly string[],
): ParsedMessage | null {
  const from = addressFrom(message.headers.from);
  if (!from) return null;

  const recipients = [
    ...addressesFrom(message.headers.to),
    ...addressesFrom(message.headers.cc),
  ];

  const fromUs = isOurAddress(from, ourDomains);
  const direction: Direction = fromUs ? "outbound" : "inbound";

  const counterparty = fromUs
    ? (recipients.find((r) => !isOurAddress(r, ourDomains)) ?? null)
    : from;
  const ours = fromUs ? from : (recipients.find((r) => isOurAddress(r, ourDomains)) ?? null);

  const millis = Number(message.internalDate);
  if (!Number.isFinite(millis)) return null;

  return {
    messageId: message.id,
    threadId: message.threadId,
    direction,
    counterpartyEmail: counterparty,
    ourAddress: ours,
    subject: message.headers.subject ?? "(no subject)",
    occurredAt: new Date(millis),
    snippet: message.snippet,
  };
}

/**
 * Which P5 brand an inbound message was addressed to.
 *
 * Returns null when the address is unrecognised, so the caller decides rather
 * than the system silently attributing a lead to the wrong company.
 */
export function brandForAddress(
  address: string | null,
  aliases: Record<string, { address: string }>,
): string | null {
  if (!address) return null;
  const wanted = address.toLowerCase();
  for (const [brand, sendAs] of Object.entries(aliases)) {
    if (sendAs.address.toLowerCase() === wanted) return brand;
  }
  return null;
}

/**
 * Is the customer waiting on us?
 *
 * True when the newest message in the conversation came from them. That single
 * question is the whole point of reading the mailbox: a deal can have an owner,
 * a stage and a next action dated next week while a customer sits unanswered,
 * and nothing else in the system would notice.
 */
export function customerIsWaiting(
  messages: { direction: Direction; occurredAt: Date }[],
): { waiting: false } | { waiting: true; since: Date } {
  if (!messages.length) return { waiting: false };
  const newest = [...messages].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  )[0];
  return newest.direction === "inbound"
    ? { waiting: true, since: newest.occurredAt }
    : { waiting: false };
}
