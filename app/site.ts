import {
  FEATURED_BOISE_ADU,
  FEATURED_BOISE_KITCHEN,
} from "./imageVariants.ts";

// Single source of truth for the production origin. Used by the metadata,
// the JSON-LD entity graph, robots.txt, and the sitemap. Change it here
// only; nothing else should hardcode the domain.
import {
  BONDED_ANSWER,
  BONDED_SINCE_2020_ANSWER,
  SELF_PERFORM_FAQ,
  SHOW_FOUNDING_YEAR,
  SHOW_UNPROVEN_SELF_PERFORM,
  SPECIALTY_FAQ,
  constructionImage,
  handymanImage,
} from "./publicClaims.ts";
import { ADU_D3_LINE } from "./publicIdentity.ts";

export const siteUrl = "https://p5homeco.com";

export const HOW_P5_WORKS_TITLE = "How P5 works";
export const HOW_P5_WORKS = [
  { title: "Tell us what you’re planning", detail: "A new home, a remodel, cabinets, repairs or an ADU. Share your project, or choose Just contact me in the P5 form." },
  { title: "Connect with the right company", detail: "Find the P5 company focused on your type of project. Contact that team to discuss the work." },
  { title: "Discuss the next steps", detail: "Review the scope with your specialist. Agree on the work, price and schedule before work begins." },
] as const;

/** Company cards in F7 / D3 order: Construction, Remodeling, Cabinet, Handyman, ADU. */
export const companies = [
  {
    name: "Boise Construction Co",
    image: constructionImage,
    url: "https://boiseconstruction.co",
    description:
      "Custom and semi-custom home building, including design, engineering, permitting, and ground-up construction.",
  },
  {
    name: "Boise Remodeling Co",
    image: FEATURED_BOISE_KITCHEN.src,
    url: "https://boiseremodeling.co",
    description:
      "Design-build remodeling for kitchens, bathrooms, whole-home renovations, and additions.",
  },
  {
    name: "Boise Cabinet Co",
    image: "/images/p5-cabinet.webp",
    url: "https://boisecabinet.co",
    description:
      "Custom cabinets designed to your measurements, built to order, and installed by our Treasure Valley crew.",
  },
  {
    name: "Boise Handyman Co",
    image: handymanImage,
    url: "https://boisehandyman.co",
    description:
      "Home repair and maintenance, including drywall and trim repair, mounting and installation, and deck and exterior repair.",
  },
  {
    name: "Boise ADU Co",
    image: FEATURED_BOISE_ADU.src,
    url: "https://boiseconstruction.co",
    description: ADU_D3_LINE,
  },
] as const;

// The nine cities P5 takes work in, confirmed by the owner 2026-09-05.
export const citiesServed = [
  "Boise",
  "Meridian",
  "Eagle",
  "Nampa",
  "Kuna",
  "Star",
  "Middleton",
  "Caldwell",
  "Garden City",
] as const;

// One source of truth for the FAQ. The section and the FAQPage schema both
// read from here, so the structured data can never claim something the page
// does not say. Every answer restates a fact already on the page.
export const faqs = [
  {
    q: "Is P5 Home Co a contractor or a referral service?",
    a: SHOW_UNPROVEN_SELF_PERFORM ? SELF_PERFORM_FAQ : SPECIALTY_FAQ,
  },
  {
    q: "Which company does what?",
    a: "Boise Construction Co builds new homes and ADUs. Boise Remodeling Co handles kitchen, bath and whole-home remodels and additions. Boise Cabinet Co designs custom cabinets to your measurements, built to order and installed by our crew. Boise Handyman Co handles repairs, installs, maintenance and RE-10 lists. Boise ADU Co projects currently run through Boise Construction Co; its site is coming. Use the company cards on this page to start with the right team.",
  },
  {
    q: "Who is my contract with?",
    a: "Your contract is with P5 Home Co LLC, Idaho Registered Contractor #8381215. Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co are DBAs of P5 Home Co LLC.",
  },
  {
    q: "How is a project that needs two companies coordinated?",
    a: "One project manager owns the handoffs. A complete kitchen, for example: Boise Remodeling Co for layout, permits, demolition and construction; Boise Cabinet Co for cabinet design and installation; Boise Handyman Co for final mounting and punch list. One contract, one project manager, one invoice.",
  },
  {
    q: "How long has P5 been operating?",
    a: "P5 Home Co was founded in Colorado in 2020 and moved the family and the company to the Treasure Valley in [year]. We live and work from Meridian, Idaho.",
  },
  {
    q: "How do I start an ADU project?",
    a: `${ADU_D3_LINE} Start with Boise Construction Co, or send a short request on this site and we will route it.`,
  },
  {
    q: "Which areas do the P5 companies serve?",
    a: "P5 companies serve homeowners across Ada and Canyon counties in Idaho's Treasure Valley, including Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden City.",
  },
  {
    q: "What happens before the work begins?",
    a: "You get planning guidance and written scope details, so you understand the work before it starts. You will know who owns the next step and who to contact, and decisions, schedule changes, and budget impacts are raised early and documented clearly.",
  },
  {
    q: "Are the P5 companies bonded and insured?",
    a: SHOW_FOUNDING_YEAR ? BONDED_SINCE_2020_ANSWER : BONDED_ANSWER,
  },
  {
    q: "What does \"don't pay for our overhead\" mean?",
    a: "No showroom, no sales team and no office lease are built into your price. You pay for the people and materials on your job, and the written scope shows every line. It does not mean cheapest. Trade partners, permits, insurance and the warranty are in the price because the job needs them.",
  },
  {
    q: "Who handles RE-10 inspection repairs?",
    a: "Boise Handyman Co handles basic home repairs and RE-10 inspection repairs. Share the repair list so the team can review the scope and next steps.",
  },
] as const;

// GA4 measurement ID for the "P5 Home Co" property (551 / 550935991) in the
// "Websites (BRC, BCC, REC, ASOS)" account. Measurement IDs are public by
// design, so this is not a secret and does not belong in an env var.
export const gaMeasurementId = "G-K4PK6PMZP9";
export const googleAdsDestinationId = "AW-18354188204";
export const googleAdsLeadLabel = "LE2vCPXstO8cEKzf-q9E";
export const googleAdsCallClickLabel = "ng9fCPiOhaAdEKzf-q9E";
export const googleAdsTextClickLabel = "lTxsCOqahaAdEKzf-q9E";
export const googleAdsPhoneConversionLabel = "YHR0CIaPz_ccEKzf-q9E";

// HubSpot portal ID for the "P5 Home Co" account (NA2 region). Portal IDs are
// public by design, so this is not a secret and does not belong in an env var.
export const hubspotPortalId = "247066159";
