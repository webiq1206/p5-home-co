/**
 * Deterministic business-hours and SLA arithmetic for the P5 always-on lead manager.
 *
 * Every timer, deadline, and escalation decision in the system resolves through
 * this module. It is intentionally free of AI, of I/O, and of dependencies: the
 * rules engine must be able to decide "has this deadline passed?" identically on
 * every machine, on every run, forever.
 *
 * Timezone handling is DST-correct for America/Boise, which observes MST/MDT.
 * We never store or reason about wall-clock strings; we convert to and from
 * absolute instants at the boundary.
 */

/** A wall-clock reading in some named timezone. */
export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
};

/**
 * Business calendar. Everything here is administrator-configurable at runtime
 * and must never be hardcoded at a call site.
 */
export type BusinessCalendar = {
  timeZone: string;
  /** Days the business operates. 0 = Sunday ... 6 = Saturday. */
  businessDays: number[];
  /** Minutes past local midnight when the business opens. 7:00am -> 420. */
  openMinute: number;
  /** Minutes past local midnight when the business closes. 6:00pm -> 1080. */
  closeMinute: number;
  /** Full-day closures as local "YYYY-MM-DD" strings. */
  holidays: string[];
};

/**
 * P5 Home Co's confirmed calendar.
 *
 * Hours (7:00am-6:00pm) and timezone are confirmed business information.
 * Business days are Monday through Saturday, confirmed by the owner on
 * 2026-08-21. Holidays start empty and are managed in admin settings.
 */
export const P5_CALENDAR: BusinessCalendar = {
  timeZone: "America/Boise",
  businessDays: [1, 2, 3, 4, 5, 6],
  openMinute: 7 * 60,
  closeMinute: 18 * 60,
  holidays: [],
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Read an absolute instant as wall-clock parts in the given timezone. */
export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // hourCycle h23 still yields "24" in some engines at exact midnight.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday] ?? 0,
  };
}

/** Offset in ms that the timezone is ahead of UTC at this instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const p = toZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Trim sub-second noise so the offset lands on an exact minute boundary.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a local wall-clock reading to the absolute instant it denotes.
 *
 * DST is handled by solving for the offset rather than assuming one. During a
 * spring-forward gap the requested wall time does not exist; we return the
 * instant at which the clock jumps past it, which is the correct "next moment
 * business could open". During a fall-back overlap we return the first (earlier)
 * of the two matching instants.
 */
export function fromZonedParts(
  local: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );

  // First guess: assume the offset that applies at the naive instant.
  const firstOffset = offsetMsAt(new Date(naive), timeZone);
  let candidate = naive - firstOffset;

  // Re-solve once; the offset may differ on the other side of a transition.
  const secondOffset = offsetMsAt(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = naive - secondOffset;
  }

  // Verify the wall clock round-trips. If it does not, the requested local time
  // falls inside a spring-forward gap and never occurs. Resolving it with the
  // pre-transition offset advances past the gap by exactly its duration, so
  // 2:30am on a spring-forward Sunday becomes 3:30am -- the same convention
  // used by Temporal's "compatible" disambiguation.
  const check = toZonedParts(new Date(candidate), timeZone);
  const wantedMinutes = (local.hour ?? 0) * 60 + (local.minute ?? 0);
  const gotMinutes = check.hour * 60 + check.minute;
  if (check.day !== local.day || gotMinutes !== wantedMinutes) {
    return new Date(naive - firstOffset);
  }
  return new Date(candidate);
}

/** Local calendar date key, e.g. "2026-08-21". */
export function dateKey(parts: ZonedParts): string {
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${parts.year}-${m}-${d}`;
}

/** True when the local date is a day the business operates. */
export function isBusinessDay(parts: ZonedParts, cal: BusinessCalendar): boolean {
  if (!cal.businessDays.includes(parts.weekday)) return false;
  return !cal.holidays.includes(dateKey(parts));
}

/** True when the instant falls inside open business hours. */
export function isWithinBusinessHours(instant: Date, cal: BusinessCalendar): boolean {
  const parts = toZonedParts(instant, cal.timeZone);
  if (!isBusinessDay(parts, cal)) return false;
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return minuteOfDay >= cal.openMinute && minuteOfDay < cal.closeMinute;
}

/** The opening instant of a given local date. */
function openingInstant(parts: ZonedParts, cal: BusinessCalendar): Date {
  return fromZonedParts(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(cal.openMinute / 60),
      minute: cal.openMinute % 60,
    },
    cal.timeZone,
  );
}

/** The closing instant of a given local date. */
function closingInstant(parts: ZonedParts, cal: BusinessCalendar): Date {
  return fromZonedParts(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(cal.closeMinute / 60),
      minute: cal.closeMinute % 60,
    },
    cal.timeZone,
  );
}

/** Local parts for the day N days after the given local date. */
function shiftLocalDay(parts: ZonedParts, days: number, timeZone: string): ZonedParts {
  const noon = fromZonedParts(
    { year: parts.year, month: parts.month, day: parts.day, hour: 12 },
    timeZone,
  );
  return toZonedParts(new Date(noon.getTime() + days * DAY_MS), timeZone);
}

/**
 * The next instant at which the business is open, at or after `instant`.
 *
 * Returns `instant` unchanged when it is already inside business hours. Scans a
 * bounded number of days so a misconfigured calendar (for example, every day
 * marked a holiday) fails loudly instead of hanging a background job.
 */
export function nextBusinessOpening(instant: Date, cal: BusinessCalendar): Date {
  if (isWithinBusinessHours(instant, cal)) return instant;

  let parts = toZonedParts(instant, cal.timeZone);

  // Today may still be openable if we are before opening time.
  if (isBusinessDay(parts, cal)) {
    const minuteOfDay = parts.hour * 60 + parts.minute;
    if (minuteOfDay < cal.openMinute) return openingInstant(parts, cal);
  }

  for (let i = 1; i <= 400; i++) {
    parts = shiftLocalDay(parts, 1, cal.timeZone);
    if (isBusinessDay(parts, cal)) return openingInstant(parts, cal);
  }

  throw new Error(
    "No business day found within 400 days. Check business days and holidays in admin settings.",
  );
}

/**
 * Business minutes elapsed between two instants, counting only open hours.
 *
 * This is the measure behind "time to first human attempt" and every SLA
 * breach decision. Returns 0 when `end` is at or before `start`.
 */
export function businessMinutesBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  if (end.getTime() <= start.getTime()) return 0;

  let total = 0;
  let cursorParts = toZonedParts(start, cal.timeZone);
  const endMs = end.getTime();

  for (let i = 0; i <= 400; i++) {
    if (isBusinessDay(cursorParts, cal)) {
      const dayOpen = openingInstant(cursorParts, cal).getTime();
      const dayClose = closingInstant(cursorParts, cal).getTime();

      const from = Math.max(dayOpen, start.getTime());
      const to = Math.min(dayClose, endMs);
      if (to > from) total += (to - from) / MINUTE_MS;
    }

    const nextOpen = openingInstant(shiftLocalDay(cursorParts, 1, cal.timeZone), cal).getTime();
    if (nextOpen >= endMs) break;
    cursorParts = shiftLocalDay(cursorParts, 1, cal.timeZone);
  }

  return Math.round(total);
}

/**
 * Add business minutes to an instant, skipping closed time.
 *
 * Used to compute SLA deadlines and follow-up due dates. A lead that arrives
 * after hours starts its clock at the next opening, so an after-hours lead is
 * never instantly overdue.
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (minutes <= 0) return nextBusinessOpening(start, cal);

  let cursor = nextBusinessOpening(start, cal);
  let remaining = minutes;

  for (let i = 0; i <= 400; i++) {
    const parts = toZonedParts(cursor, cal.timeZone);
    const dayClose = closingInstant(parts, cal).getTime();
    const availableMinutes = (dayClose - cursor.getTime()) / MINUTE_MS;

    if (remaining <= availableMinutes) {
      return new Date(cursor.getTime() + remaining * MINUTE_MS);
    }

    remaining -= availableMinutes;
    cursor = nextBusinessOpening(new Date(dayClose + MINUTE_MS), cal);
  }

  throw new Error("Could not resolve an SLA deadline within 400 business days.");
}

/** Escalation tiers for an unanswered new lead, in business minutes. */
export type EscalationTier = "none" | "owner" | "owner_manager" | "critical" | "administrator";

export type EscalationThresholds = {
  owner: number;
  ownerManager: number;
  critical: number;
  administrator: number;
};

/** Defaults from the build brief. Administrator-configurable. */
export const DEFAULT_ESCALATION: EscalationThresholds = {
  owner: 5,
  ownerManager: 15,
  critical: 30,
  administrator: 60,
};

/**
 * Which escalation tier a lead has reached.
 *
 * Deterministic and derived purely from elapsed business minutes. AI is never
 * consulted about whether a deadline has passed.
 */
export function escalationTierFor(
  businessMinutesElapsed: number,
  thresholds: EscalationThresholds = DEFAULT_ESCALATION,
): EscalationTier {
  if (businessMinutesElapsed >= thresholds.administrator) return "administrator";
  if (businessMinutesElapsed >= thresholds.critical) return "critical";
  if (businessMinutesElapsed >= thresholds.ownerManager) return "owner_manager";
  if (businessMinutesElapsed >= thresholds.owner) return "owner";
  return "none";
}
