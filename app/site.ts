import { BONDED_ANSWER, BONDED_SINCE_2020_ANSWER, SHOW_FOUNDING_YEAR } from "./publicClaims.ts";

// Single source of truth for the production origin. Used by the metadata,
// the JSON-LD entity graph, robots.txt, and the sitemap. Change it here
// only; nothing else should hardcode the domain.
export const siteUrl = "https://p5homeco.com";

export const companies = [
  {
    name: "Boise Construction Co",
    image: "/images/p5-construction-branded.webp",
    url: "https://boiseconstruction.co",
    description:
      "Custom and semi-custom home building, including design, engineering, permitting, and ground-up construction.",
  },
  {
    name: "Boise Remodeling Co",
    image: "/images/p5-remodel.webp",
    url: "https://boiseremodeling.co",
    description:
      "Design-build remodeling for kitchens, bathrooms, whole-home renovations, additions, and ADUs.",
  },
  {
    name: "Boise ADU Co",
    image: "/images/p5-adu.webp",
    url: "https://boiseadu.co",
    description:
      "Accessory dwelling units, including detached ADUs, garage conversions, basement and interior units, and feasibility and permitting. Launching soon.",
  },
  {
    name: "Boise Handyman Co",
    image: "/images/p5-handyman-branded.webp",
    url: "https://boisehandyman.co",
    description:
      "Home repair and maintenance, including drywall and trim repair, mounting and installation, and deck and exterior repair.",
  },
  {
    name: "Boise Cabinet Co",
    image: "/images/p5-cabinet.webp",
    url: "https://boisecabinet.co",
    description:
      "Custom frameless cabinetry, including kitchen cabinets, bathroom vanities, built-ins, and whole-home cabinetry.",
  },
] as const;

// The nine cities P5 takes work in, confirmed by the owner 2026-09-05.
// The service-area section on the homepage renders from this list rather
// than repeating it, so the visible page and the structured data cannot
// drift apart - which is exactly how Garden City went missing before.
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
    a: "P5 Home Co is an operating family of companies, not a directory or a referral network. Each of the five companies has its own craft and team, and does the work itself, under one shared standard for scopes, communication, and accountability.",
  },
  {
    q: "Which P5 company should I start with?",
    a: "Start with the project rather than the company. New homes go to Boise Construction Co, renovations to Boise Remodeling Co, accessory dwellings to Boise ADU Co, repairs and installations to Boise Handyman Co, and cabinetry to Boise Cabinet Co. The three-step matcher on this page will point you to the right one.",
  },
  {
    q: "What if my project needs more than one company?",
    a: "P5 routes the work between companies without sending you back to the start. A complete kitchen runs through Boise Remodeling Co for layout, permits, demolition, and construction, Boise Cabinet Co for cabinet design and installation, and Boise Handyman Co for final mounting and punch-list items.",
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
    q: "Who builds a new home, or builds on land you already own?",
    a: "Boise Construction Co. That work includes custom homes, semi-custom homes, building on your own lot, and home design and plans. Design, engineering, permitting, and construction stay with one accountable team.",
  },
  {
    q: "Who renovates, adds on to, or changes how an existing home works?",
    a: "Boise Remodeling Co. That work includes kitchen remodeling, bathroom remodeling, whole-home remodeling, additions, and ADUs, managed under one roof with a written scope and coordinated permits.",
  },
  {
    q: "Who adds a guest suite, rental unit, or multigenerational living space on land you already own?",
    a: "Boise ADU Co. That work includes detached ADUs, garage conversions, basement and interior units, and feasibility and permitting. The website is not live yet; enquiries go to (208) 477-1169.",
  },
  {
    q: "Who handles repairs, installations, finish work, and smaller home projects?",
    a: "Boise Handyman Co. That work includes drywall and trim repair, TV and fixture mounting, deck and exterior repair, and general home maintenance.",
  },
  {
    q: "Who handles cabinetry, vanities, built-ins, and coordinated storage?",
    a: "Boise Cabinet Co. That work includes premium frameless kitchen cabinetry, bathroom vanities, built-ins and storage, and whole-home cabinetry, designed, sourced, and installed.",
  },
  {
    q: "Can one project involve more than one company?",
    a: "Yes. A complete kitchen transformation, for example, runs through Boise Remodeling Co for layout, permits, demolition, and construction; Boise Cabinet Co for cabinet design, sourcing, and installation; and Boise Handyman Co for final mounting, finish work, and punch-list items.",
  },
] as const;

// GA4 measurement ID for the "P5 Home Co" property (551 / 550935991) in the
// "Websites (BRC, BCC, REC, ASOS)" account. Measurement IDs are public by
// design, so this is not a secret and does not belong in an env var.
export const gaMeasurementId = "G-K4PK6PMZP9";
export const googleAdsDestinationId = "AW-18354188204";
export const googleAdsLeadLabel = "LE2vCPXstO8cEKzf-q9E";

// HubSpot portal ID for the "P5 Home Co" account (NA2 region). Portal IDs are
// public by design, so this is not a secret and does not belong in an env var.
export const hubspotPortalId = "247066159";
