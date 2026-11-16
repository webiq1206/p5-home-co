/**
 * The one booking link ("Meet with P5 Home Co"). Browser-safe, so the estimate
 * page, the confirmation email and the QuickBooks estimate all point at the
 * same calendar. Durations on the page are 15, 30, 60 and 120 minutes.
 */
export const SCHEDULE_URL = "https://meetings-na2.hubspot.com/client3";

/** Printed on every QuickBooks estimate the platform builds, so the document itself carries the link. */
export const SCHEDULE_MEMO = `Schedule a time with us: ${SCHEDULE_URL}`;
