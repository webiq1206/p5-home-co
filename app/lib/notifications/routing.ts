/**
 * Who hears about what, and when.
 *
 * Pure and dependency-free, because these are the decisions that determine
 * whether the system is trusted or muted. An alert that reaches the wrong
 * person is ignored; one that arrives at 2am for something that could wait
 * until 7am trains people to ignore the ones that cannot.
 */

import type { EscalationTier } from "../leads/time.ts";
import { isWithinBusinessHours, type BusinessCalendar } from "../leads/time.ts";

/** Someone who can be told. */
export type Recipient = {
  userId: number | null;
  email: string;
  name: string;
};

/** One thing worth telling someone about. */
export type Notifiable = {
  alertId: number;
  dealId: number;
  kind: string;
  tier: EscalationTier;
  reason: string;
  clientName: string;
  brand: string;
  /** When the alert fired. Used for ordering and cooldown. */
  raisedAt: Date;
  /**
   * When the lead actually arrived.
   *
   * This, not raisedAt, is how long the customer has been waiting. The alert
   * may have fired seconds ago on a lead that came in nine hours earlier, and
   * a message saying "waited 0 minutes" would undercut the very urgency it is
   * trying to convey.
   */
  receivedAt: Date;
  lastNotifiedAt: Date | null;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerUserId: number | null;
};

/**
 * Alerts that must go out regardless of the hour.
 *
 * Everything else waits for business hours. These two mean a customer has
 * been waiting far too long already, and holding them until morning would
 * make the system complicit in the delay it exists to prevent.
 */
const ALWAYS_URGENT = new Set(["response_ceiling_breached"]);

export function isUrgent(item: Notifiable): boolean {
  if (ALWAYS_URGENT.has(item.kind)) return true;
  return item.tier === "critical" || item.tier === "administrator";
}

/**
 * Whether this alert may be sent right now.
 *
 * Three gates, in order: has it been sent recently, is it urgent enough to
 * interrupt, and are we inside business hours.
 */
export function shouldSendNow(
  item: Notifiable,
  now: Date,
  calendar: BusinessCalendar,
  cooldownMinutes: number,
): { send: true } | { send: false; because: string } {
  if (item.lastNotifiedAt) {
    const minutesSince = (now.getTime() - item.lastNotifiedAt.getTime()) / 60_000;
    if (minutesSince < cooldownMinutes) {
      return { send: false, because: `notified ${Math.round(minutesSince)}m ago` };
    }
  }

  // Urgent items interrupt. Everything else waits for the working day, so
  // routine nudges do not arrive overnight and get muted.
  if (isUrgent(item)) return { send: true };

  if (!isWithinBusinessHours(now, calendar)) {
    return { send: false, because: "outside business hours and not urgent" };
  }

  return { send: true };
}

/**
 * Who should be told about one alert.
 *
 * The ladder mirrors the escalation tiers: the owner first, their manager
 * once it has been ignored, and administrators when it has gone badly wrong.
 * Recipients are de-duplicated by email, so nobody is mailed twice because
 * they happen to be both owner and manager on a small team.
 */
export function recipientsFor(
  item: Notifiable,
  managers: Recipient[],
  administrators: Recipient[],
): Recipient[] {
  const out: Recipient[] = [];

  if (item.ownerEmail) {
    out.push({
      userId: item.ownerUserId,
      email: item.ownerEmail,
      name: item.ownerName ?? item.ownerEmail,
    });
  }

  // An unowned lead has nobody to nudge, so it goes straight to the people
  // who can assign it.
  const unowned = !item.ownerEmail || item.kind === "missing_owner";
  if (unowned || item.tier === "owner_manager" || item.tier === "critical" || item.tier === "administrator") {
    out.push(...managers);
  }
  if (item.tier === "administrator" || ALWAYS_URGENT.has(item.kind)) {
    out.push(...administrators);
  }

  const seen = new Set<string>();
  return out.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Alerts grouped by the person who needs to see them. */
export type Bundle = { recipient: Recipient; items: Notifiable[] };

/**
 * Group alerts per recipient.
 *
 * One message listing five leads beats five messages listing one. The
 * difference decides whether a busy person reads it or filters it.
 */
export function bundleByRecipient(
  pairs: { item: Notifiable; recipients: Recipient[] }[],
): Bundle[] {
  const byEmail = new Map<string, Bundle>();

  for (const { item, recipients } of pairs) {
    for (const recipient of recipients) {
      const key = recipient.email.toLowerCase();
      const existing = byEmail.get(key);
      if (existing) existing.items.push(item);
      else byEmail.set(key, { recipient, items: [item] });
    }
  }

  // Most urgent first within each bundle, then longest-waiting.
  const rank: Record<string, number> = {
    administrator: 0, critical: 1, owner_manager: 2, owner: 3, none: 4,
  };
  for (const bundle of byEmail.values()) {
    bundle.items.sort(
      (a, b) =>
        (rank[a.tier] ?? 9) - (rank[b.tier] ?? 9) ||
        a.raisedAt.getTime() - b.raisedAt.getTime(),
    );
  }

  return [...byEmail.values()];
}
