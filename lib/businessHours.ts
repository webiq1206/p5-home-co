/** Public hours Jared confirmed. Mountain time. Sunday is closed.
 * Schema, the public identity line, llms.txt, and the vCard read this. */
export const BUSINESS_HOURS = {
  monday: "9:00 AM - 6:00 PM",
  tuesday: "9:00 AM - 6:00 PM",
  wednesday: "9:00 AM - 6:00 PM",
  thursday: "9:00 AM - 6:00 PM",
  friday: "9:00 AM - 6:00 PM",
  saturday: "9:00 AM - 4:00 PM",
  sunday: "Closed",
} as const;

export const BUSINESS_HOURS_LABEL =
  "Mon-Fri 9 AM-6 PM and Sat 9 AM-4 PM Mountain (Sunday closed)";

function schemaClock(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error("Office hours must be a 12-hour clock time.");
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** Mo-Fr 09:00-18:00 and Sa 09:00-16:00. Sunday is omitted because it is closed. */
export function officeOpeningHours() {
  return (Object.entries(BUSINESS_HOURS) as Array<[string, string]>)
    .filter(([, hours]) => hours !== "Closed")
    .map(([day, hours]) => {
      const [open, close] = hours.split(" - ");
      return {
        "@type": "OpeningHoursSpecification" as const,
        dayOfWeek: day.charAt(0).toUpperCase() + day.slice(1),
        opens: schemaClock(open),
        closes: schemaClock(close),
      };
    });
}
