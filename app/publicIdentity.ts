import { BUSINESS_HOURS_LABEL } from "../lib/businessHours.ts";

/** Customer-facing identity for p5homeco.com. Phone stays in local format;
 * schema telephone is E.164. The public address is the city and postal code.
 * There is no street on the site or in schema. Ads stay off the locality.
 * There is no shop or showroom, so public copy never invites a visit. */

export const PUBLIC_REPRESENTATIVE = "Nick Perkins";

export const PUBLIC_PHONE_DISPLAY = "(208) 477-1169";

export const PUBLIC_PHONE_TEL = "tel:+12084771169";

export const PUBLIC_PHONE_SMS = "sms:+12084771169";

/** P5 Home Co's Facebook page. The vanity URL is the same Page (page id 61591579240451). */
export const P5_FACEBOOK_URL = "https://www.facebook.com/p5homeco";

/** P5 Home Co's Instagram, the one account for every family site (owner, 20 November 2026). */
export const P5_INSTAGRAM_URL = "https://www.instagram.com/p5_home_co";

/** P5 Home Co Google Business Profile (category General contractor), knowledge graph id /g/11ntl1t7dc.
 * The brands have no profiles of their own, so this belongs in P5 sameAs only (owner call A, 1 November). */
export const P5_GOOGLE_BUSINESS_PROFILE_URL = "https://www.google.com/search?kgmid=/g/11ntl1t7dc";

/** Share link https://g.page/r/CTXOovWjr7ekEBM redirects to feature id
 * 0xa23f3afb6a2813cf:0xa4b7afa3f5a2ce35. That listing is P5 Home Co, with the
 * same hours as the site. The CID is the second half of the feature id. The
 * Place ID is that feature id in Google's encoding. The embed is place mode
 * for this listing, not a pin on the street. */
export const P5_GBP_MAPS_URL = "https://maps.google.com/?cid=11869148461693849141";
export const P5_GBP_PLACE_ID = "ChIJzxMoavs6P6IRNc6i9aOvt6Q";
export const P5_GBP_MAP_EMBED_URL =
  "https://www.google.com/maps/embed?origin=mfe&pb=!1m2!2m1!1splace_id:ChIJzxMoavs6P6IRNc6i9aOvt6Q";

/** Published locality. No street. */
export const PUBLIC_ADDRESS_LOCALITY = "Meridian";
export const PUBLIC_ADDRESS_REGION = "ID";
export const PUBLIC_POSTAL_CODE = "83646";
export const PUBLIC_ADDRESS = "Meridian, ID 83646";

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

/**
 * The footer's registration line, tied to the legal entity (family audit XS-05:
 * one line in every family footer). The homepage credential strip keeps the
 * shorter PUBLIC_REGISTRATION.
 */
export const FOOTER_REGISTRATION = `${SCHEMA_LEGAL_NAME}, ${PUBLIC_REGISTRATION}`;

/** Accessible name for the registration link: the visible text first, then the new-tab note (P5-T2). */
export const REGISTRATION_LINK_LABEL = `${FOOTER_REGISTRATION}, opens in a new tab`;

/** Idaho DOPL public registration search. Footer links use this. Estimator pages do not. */
export const IDAHO_DOPL_LICENSE_SEARCH = "https://edopl.idaho.gov/OnlineServices/?link=PubSearch";

export const SISTER_LINE =
  "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Cabinet Co · Boise Handyman Co · Boise ADU Co projects run through Boise Construction Co.";

export const LLMS_CONTACT =
  `Serving Boise and the Treasure Valley. Phone (208) 477-1169. Email hello@p5homeco.com. Hours: ${BUSINESS_HOURS_LABEL}.`;

export const SISTER_LINKS = [
  { label: "Boise Construction Co", href: "https://boiseconstruction.co" },
  { label: "Boise Remodeling Co", href: "https://boiseremodeling.co" },
  { label: "Boise Cabinet Co", href: "https://boisecabinet.co" },
  { label: "Boise Handyman Co", href: "https://boisehandyman.co" },
  { label: "Boise ADU Co", href: "/quote/adu" },
] as const;

/** Project-routing line for the ADU card and FAQ. */
export const ADU_D3_LINE =
  "Boise ADU Co projects run through Boise Construction Co.";

export const ADU_CONSTRUCTION_URL = "https://boiseconstruction.co";

/** Owner decision, 8 November 2026: until a Boise ADU Co site exists, ADU
 * requests go to the P5 ADU quote entry. Never link the unlaunched ADU domain. */
export const ADU_REQUEST_PATH = "/quote/adu";
