// Single source of truth for the production origin. Used by the metadata,
// the JSON-LD entity graph, robots.txt, and the sitemap. Change it here
// only; nothing else should hardcode the domain.
export const siteUrl = "https://p5homeco.com";

export const companies = [
  {
    name: "Boise Construction Co",
    url: "https://boiseconstruction.co",
    description:
      "Custom and semi-custom home building, including design, engineering, permitting, and ground-up construction.",
  },
  {
    name: "Boise Remodeling Co",
    url: "https://boiseremodeling.co",
    description:
      "Design-build remodeling for kitchens, bathrooms, whole-home renovations, additions, and ADUs.",
  },
  {
    name: "Boise ADU Co",
    url: "https://boiseadu.co",
    description:
      "Accessory dwelling units, including detached ADUs, garage conversions, basement and interior units, and feasibility and permitting. Launching soon.",
  },
  {
    name: "Boise Handyman Co",
    url: "https://boisehandyman.co",
    description:
      "Home repair and maintenance, including drywall and trim repair, mounting and installation, and deck and exterior repair.",
  },
  {
    name: "Boise Cabinet Co",
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
