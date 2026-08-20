// Single source of truth for the production origin. Used by the metadata,
// the JSON-LD entity graph, robots.txt, and the sitemap. Change it here
// only; nothing else should hardcode the domain.
export const siteUrl = "https://p5homeco.com";

export const companies = [
  {
    name: "Boise Construction Co",
    image: "/images/p5-construction-v2.webp",
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
    image: "/images/p5-handyman.webp",
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

// Cities named on the page. Kept in sync with the service-area section so
// the structured data never claims coverage the page does not state.
export const citiesServed = [
  "Boise",
  "Meridian",
  "Eagle",
  "Nampa",
  "Kuna",
  "Star",
  "Middleton",
  "Caldwell",
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
    a: "P5 companies serve homeowners across Ada and Canyon counties in Idaho's Treasure Valley, including Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, and Caldwell.",
  },
  {
    q: "What happens before the work begins?",
    a: "You get planning guidance and written scope details, so you understand the work before it starts. You will know who owns the next step and who to contact, and decisions, schedule changes, and budget impacts are raised early and documented clearly.",
  },
  {
    q: "Are the P5 companies bonded and insured?",
    a: "Yes. The P5 companies are bonded and insured, have worked across the Treasure Valley since 2020, and handle permits in-house where a project requires them.",
  },
] as const;

// GA4 measurement ID for the "P5 Home Co" property (551 / 550935991) in the
// "Websites (BRC, BCC, REC, ASOS)" account. Measurement IDs are public by
// design, so this is not a secret and does not belong in an env var.
export const gaMeasurementId = "G-K4PK6PMZP9";
