import { BUSINESS_HOURS_LABEL } from "../lib/businessHours.ts";

/** Customer-facing identity for p5homeco.com. Phone stays in local format;
 * schema telephone is E.164. Street-address verification records stay outside
 * public pages, components and discovery artifacts. */

export const PUBLIC_REPRESENTATIVE = "Nick Perkins";

export const PUBLIC_PHONE_DISPLAY = "(208) 477-1169";

export const PUBLIC_PHONE_TEL = "tel:+12084771169";

export const PUBLIC_PHONE_SMS = "sms:+12084771169";

/** P5 Home Co's own Facebook page (confirmed by the coordinator via the Facebook API, 31 October). */
export const P5_FACEBOOK_URL = "https://www.facebook.com/1228704823655951";

/** P5 Home Co Google Business Profile (category General contractor), knowledge graph id /g/11ntl1t7dc.
 * The brands have no profiles of their own, so this belongs in P5 sameAs only (owner call A, 1 November). */
export const P5_GOOGLE_BUSINESS_PROFILE_URL = "https://www.google.com/search?kgmid=/g/11ntl1t7dc";

export const PUBLIC_EMAIL = "hello@p5homeco.com";

export const SCHEMA_TELEPHONE = "+1-208-477-1169";

export const NICK_PERKINS_ID = "https://p5homeco.com/#nick-perkins";

/** Matches the legalName already published on the DBA sites. */
export const SCHEMA_LEGAL_NAME = "P5 Home Co LLC";

/** Already published on the quote pages. Not a new statistic. */
export const CONTRACTOR_REGISTRATION = "8381215";

export const PUBLIC_NAP =
  "Serving Boise and the Treasure Valley · (208) 477-1169 · hello@p5homeco.com";

export const PUBLIC_REGISTRATION = "Idaho Registered Contractor #8381215";

/** Idaho DOPL public registration search. Footer links use this. Estimator pages do not. */
export const IDAHO_DOPL_LICENSE_SEARCH = "https://edopl.idaho.gov/OnlineServices/?link=PubSearch";

export const SISTER_LINE =
  "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Cabinet Co · Boise Handyman Co · Boise ADU Co projects run through Boise Construction Co.";

export const LLMS_CONTACT =
  `Serving Boise and the Treasure Valley. Phone (208) 477-1169. Email hello@p5homeco.com. Hours: ${BUSINESS_HOURS_LABEL}.`;

/** Public ADU destination. boiseadu.co is not a public link. */
export const ADU_QUOTE_URL = "https://p5homeco.com/quote/adu";

export function leavesThisSite(href: string): boolean {
  return href.startsWith("http") && !href.startsWith("https://p5homeco.com") && !href.startsWith("http://p5homeco.com");
}

export const SISTER_LINKS = [
  { label: "Boise Construction Co", href: "https://boiseconstruction.co" },
  { label: "Boise Remodeling Co", href: "https://boiseremodeling.co" },
  { label: "Boise Cabinet Co", href: "https://boisecabinet.co" },
  { label: "Boise Handyman Co", href: "https://boisehandyman.co" },
  { label: "Boise ADU Co", href: ADU_QUOTE_URL },
] as const;

/** Project-routing line for the ADU card and FAQ. */
export const ADU_D3_LINE =
  "Boise ADU Co projects run through Boise Construction Co.";

export const ADU_CONSTRUCTION_URL = "https://boiseconstruction.co";
