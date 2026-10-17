import { BUSINESS_HOURS_LABEL } from "../lib/businessHours.ts";

/** Shared public identity for p5homeco.com.
 *
 * The strings are the audit's canonical wording (F1, F8, F10, F11). Visible
 * phone stays in local format. Schema telephone is E.164 and lives beside
 * the Person block in app/structuredData.ts.
 */

export const PUBLIC_REPRESENTATIVE = "Nick Perkins";

export const PUBLIC_ADDRESS = "4031 W Wapoot St, Meridian, ID 83646";

export const PUBLIC_PHONE_DISPLAY = "(208) 477-1169";

export const PUBLIC_PHONE_TEL = "tel:+12084771169";

export const PUBLIC_EMAIL = "hello@p5homeco.com";

export const SCHEMA_TELEPHONE = "+1-208-477-1169";

export const NICK_PERKINS_ID = "https://p5homeco.com/#nick-perkins";

/** Matches the legalName already published on the DBA sites. */
export const SCHEMA_LEGAL_NAME = "P5 Home Co LLC";

/** Already published on the quote pages. Not a new statistic. */
export const CONTRACTOR_REGISTRATION = "8381215";

export const PUBLIC_NAP =
  "Public representative: Nick Perkins · 4031 W Wapoot St, Meridian, ID 83646 · Service-area business, not a staffed storefront. · (208) 477-1169 · hello@p5homeco.com";

export const PUBLIC_REGISTRATION = "Idaho contractor registration 8381215.";

export const SISTER_LINE =
  "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Handyman Co · Boise Cabinet Co · Boise ADU Co (launching soon)";

export const LLMS_CONTACT =
  `Public representative: Nick Perkins. Service-area business based at 4031 W Wapoot St, Meridian, ID 83646 (not a staffed storefront). Phone (208) 477-1169. Email hello@p5homeco.com. Hours: ${BUSINESS_HOURS_LABEL}.`;

export const SISTER_LINKS = [
  { label: "Boise Construction Co", href: "https://boiseconstruction.co" },
  { label: "Boise Remodeling Co", href: "https://boiseremodeling.co" },
  { label: "Boise Handyman Co", href: "https://boisehandyman.co" },
  { label: "Boise Cabinet Co", href: "https://boisecabinet.co" },
] as const;
