/**
 * Local search wording for image descriptions (owner, 19 November 2026: every
 * image on every page carries an alt that names the work and the place).
 *
 * The form is "<work> in <city>, Idaho: <what the picture shows>". The part
 * after the colon stays a plain account of what is in the frame, for screen
 * readers. Owner direction, same day: no qualifier word in or beside an image
 * description (tests/local-alt.test.ts holds the list).
 */

export interface LocalAltContext {
  /** The work the picture belongs to: "kitchen remodeling", "custom home building". Defaults to "home remodeling". */
  subject?: string;
  /** City name without the state. Defaults to Boise, the primary city. */
  city?: string;
}

const PLACE_NAMES = ["Boise", "Meridian", "Eagle", "Nampa", "Kuna", "Star", "Middleton", "Caldwell", "Idaho", "Treasure", "Ada", "Canyon", "P5", "Nick"];

/** Lower the first letter unless the description opens with a name or an acronym. */
function lowerFirst(text: string): string {
  const first = (text.split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (/^[A-Z0-9]{2,}/.test(first) || PLACE_NAMES.includes(first)) return text;
  if (/^A\s/.test(text)) return `a${text.slice(1)}`;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function localAlt(description: string, context: LocalAltContext = {}): string {
  const text = description.trim().replace(/\.$/, "");
  if (!text) return "";
  // Already names its own place ("... in Meridian, Idaho"): left exactly as written.
  if (/\b[A-Z][a-z]+, Idaho\b/.test(text)) return text;
  const subject = (context.subject ?? "home remodeling").trim();
  const city = (context.city ?? "Boise").replace(/,\s*Idaho$/i, "").trim();
  const lead = /^[A-Z]{2,}/.test(subject) ? subject : subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${lead} in ${city}, Idaho: ${lowerFirst(text)}`;
}
