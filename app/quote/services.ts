/**
 * The service variants of the quote page.
 *
 * Message match is the highest-leverage lever in paid search: someone who
 * searched "kitchen remodel meridian" should land on a page whose headline
 * says kitchen remodel, not one that opens by explaining a five-company
 * corporate structure. Each entry below is one ad group's destination.
 *
 * Every `project` value must exist in PROJECT_OPTIONS, so the variant can
 * pre-select the right option in the form and the lead reaches the right
 * company. A test asserts that, because a typo here would silently route a
 * paid lead to the parent instead of the specialist.
 */

import type { Brand } from "../lib/leads/types.ts";

export interface QuoteService {
  /** URL segment: /quote/<slug>. */
  readonly slug: string;
  /** Used in internal links and the breadcrumb. */
  readonly label: string;
  readonly h1: string;
  /** The direct answer, ~40-60 words, above everything else. */
  readonly lead: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly image: string;
  readonly imageAlt: string;
  /** Must match a PROJECT_OPTIONS value exactly. */
  readonly project: string;
  readonly brand: Brand;
  /** Three specifics, shown as the "what this covers" list. */
  readonly covers: readonly string[];
}

export const QUOTE_SERVICES: readonly QuoteService[] = [
  {
    slug: "kitchen-remodel",
    label: "Kitchen remodel",
    h1: "Kitchen remodeling quotes in the Treasure Valley",
    lead: "Tell us about your kitchen and Boise Remodeling Co puts together a written quote covering layout, cabinetry, surfaces, and the trades in between. Free, no obligation, and priced as one scope rather than a stack of separate bids you have to reconcile yourself.",
    metaTitle: "Kitchen Remodel Quote, Boise & Meridian | P5 Home Co",
    metaDescription:
      "Free kitchen remodeling quotes across Boise, Meridian, Eagle, and the Treasure Valley. One written scope covering layout, cabinetry, and every trade.",
    image: "/images/p5-remodel.webp",
    imageAlt: "A renovated kitchen interior with custom cabinetry and an island.",
    project: "Kitchen remodel",
    brand: "Boise Remodeling Co",
    covers: [
      "Layout changes, wall removal, and structural work",
      "Cabinetry, counters, lighting, and appliances",
      "Permits handled in-house where the work needs them",
    ],
  },
  {
    slug: "bathroom-remodel",
    label: "Bathroom remodel",
    h1: "Bathroom remodeling quotes in the Treasure Valley",
    lead: "Send us the bathroom you want changed and Boise Remodeling Co returns a written quote covering demolition, waterproofing, tile, fixtures, and finish work. Free, no obligation, and scoped so you can see exactly what is and is not included before you commit.",
    metaTitle: "Bathroom Remodel Quote, Boise & Meridian | P5 Home Co",
    metaDescription:
      "Free bathroom remodeling quotes across Boise, Meridian, Eagle, and the Treasure Valley. Written scopes covering tile, fixtures, and waterproofing.",
    image: "/images/p5-bathroom.webp",
    imageAlt: "Bathroom with a glass shower, freestanding tub, and wood vanity.",
    project: "Bathroom remodel",
    brand: "Boise Remodeling Co",
    covers: [
      "Demolition, waterproofing, and tile",
      "Vanities, fixtures, lighting, and ventilation",
      "Written change orders before anything shifts",
    ],
  },
  {
    slug: "home-addition",
    label: "Home addition",
    h1: "Home addition quotes in the Treasure Valley",
    lead: "Adding on changes how the whole house works, so Boise Remodeling Co quotes it as one scope: foundation, framing, roof tie-in, mechanicals, and finishes. Free, no obligation, with the permitting path spelled out before you commit to anything.",
    metaTitle: "Home Addition Quote, Boise & Meridian | P5 Home Co",
    metaDescription:
      "Free home addition quotes across the Treasure Valley. One written scope covering foundation, framing, roof tie-in, mechanicals, and permits. No obligation.",
    image: "/images/p5-addition.webp",
    imageAlt: "Living room addition with a vaulted ceiling and stone fireplace.",
    project: "Home addition",
    brand: "Boise Remodeling Co",
    covers: [
      "Foundation, framing, and roof tie-in",
      "Mechanical, electrical, and plumbing runs",
      "Ada and Canyon County permitting",
    ],
  },
  {
    slug: "custom-home",
    label: "Custom home",
    h1: "Custom home building quotes in the Treasure Valley",
    lead: "Whether you have land, plans, or just an idea, Boise Construction Co will price the build and tell you what the site actually allows. Free, no obligation, and honest about feasibility before you spend money on drawings that will not work.",
    metaTitle: "Custom Home Building Quote, Treasure Valley | P5 Home Co",
    metaDescription:
      "Free custom home building quotes across Ada and Canyon counties. Land evaluation, plans, engineering, permitting, and construction under one accountable team.",
    image: "/images/p5-construction-branded.webp",
    imageAlt: "Timber framing at a home construction site with Boise Construction Co branding.",
    project: "New custom home",
    brand: "Boise Construction Co",
    covers: [
      "Land evaluation and feasibility",
      "Plans, engineering, and permitting",
      "Ground-up construction with one accountable team",
    ],
  },
  {
    slug: "adu",
    label: "ADU",
    h1: "ADU and garage conversion quotes in the Treasure Valley",
    lead: "Accessory dwelling units turn on what your lot and your city will allow, so Boise ADU Co starts with feasibility and then prices the build. Free, no obligation, covering detached units, garage conversions, and basement or interior conversions.",
    metaTitle: "ADU & Garage Conversion Quote, Boise | P5 Home Co",
    metaDescription:
      "Free ADU quotes across the Treasure Valley: detached units, garage conversions, and basement conversions, with feasibility and permits handled by one P5 team.",
    image: "/images/p5-adu.webp",
    imageAlt: "Detached ADU with a covered entry and landscaped yard.",
    project: "Accessory dwelling unit (ADU)",
    brand: "Boise ADU Co",
    covers: [
      "Feasibility for your lot and your city",
      "Detached ADUs, garage and basement conversions",
      "Permitting handled in-house",
    ],
  },
  {
    slug: "custom-cabinets",
    label: "Custom cabinets",
    h1: "Custom cabinetry quotes in the Treasure Valley",
    lead: "Boise Cabinet Co designs, builds, and installs frameless cabinetry to order, so a quote starts from your actual room rather than a catalogue size. Free, no obligation, covering kitchens, vanities, built-ins, and whole-home cabinetry.",
    metaTitle: "Custom Cabinet Quote, Boise & Meridian | P5 Home Co",
    metaDescription:
      "Free custom cabinetry quotes across the Treasure Valley. Frameless kitchen cabinets, vanities, and built-ins, designed and built to order. No obligation.",
    image: "/images/p5-cabinet.webp",
    imageAlt: "Wood cabinetry with brass pulls and a light countertop.",
    project: "Custom cabinets or built-ins",
    brand: "Boise Cabinet Co",
    covers: [
      "Kitchens, vanities, built-ins, and storage",
      "Built to order for out-of-square walls",
      "Design, fabrication, and installation",
    ],
  },
  {
    slug: "handyman",
    label: "Home repairs",
    h1: "Home repair and handyman quotes in the Treasure Valley",
    lead: "Boise Handyman Co takes the jobs that are too small for a general contractor and too skilled for a weekend. Send a list and get one written price. Free, no obligation, covering repairs, mounting, installation, and multi-item home lists.",
    metaTitle: "Handyman & Home Repair Quote, Boise | P5 Home Co",
    metaDescription:
      "Free handyman and home repair quotes across the Treasure Valley. Drywall and trim repair, mounting, installation, deck and exterior work.",
    image: "/images/p5-handyman-branded.webp",
    imageAlt: "Trim installation in progress with Boise Handyman Co branding.",
    project: "Home repairs or handyman work",
    brand: "Boise Handyman Co",
    covers: [
      "Drywall, trim, and finish repair",
      "Mounting, installation, and deck work",
      "One price for a whole list of items",
    ],
  },
] as const;

/**
 * One question per variant, specific to that trade.
 *
 * It goes first in the FAQ, ahead of the shared questions about quoting, so
 * no two quote pages ship an identical FAQPage - near-duplicate structured
 * data across seven pages helps nobody.
 */
export const SERVICE_FAQ: Record<string, { q: string; a: string }> = {
  "kitchen-remodel": {
    q: "Do I need to have chosen cabinets and finishes before you can quote?",
    a: "No. A quote can be built from a layout and an allowance for cabinetry, counters, and fixtures, then firmed up once selections are made. Starting with allowances is normal and stops the selection process from holding up the schedule.",
  },
  "bathroom-remodel": {
    q: "Will I lose the use of the bathroom for the whole project?",
    a: "For a full remodel, yes, that bathroom is out of use while it is worked on. The written scope states the expected duration up front, and in a single-bathroom home the schedule is planned around that rather than discovered halfway through.",
  },
  "home-addition": {
    q: "Do you handle the design and engineering, or do I need plans first?",
    a: "Either way works. Boise Remodeling Co can take an addition from concept through design, engineering, and permitting, or price and build from drawings you already have. Bring what you have and the quote will say what is still needed.",
  },
  "custom-home": {
    q: "Can you tell me whether a lot will work before I buy it?",
    a: "Yes, and that is the cheapest moment to ask. Boise Construction Co evaluates access, utilities, slope, setbacks, and what the jurisdiction allows, so a lot that will not support the home you want is ruled out before you own it.",
  },
  adu: {
    q: "Will my city actually allow an ADU on my lot?",
    a: "It depends on the jurisdiction, the lot, and the setbacks, and the rules differ across Ada and Canyon counties. Feasibility comes first: Boise ADU Co checks what your specific lot and city allow before anything is designed or priced.",
  },
  "custom-cabinets": {
    q: "Can you match cabinetry to what is already in the house?",
    a: "Usually. Because the cabinetry is built to order rather than ordered in catalogue sizes, doors, finishes, and dimensions can be matched to existing work, and out-of-square walls and uneven floors in older Treasure Valley homes are handled in the build.",
  },
  handyman: {
    q: "Is there a minimum job size?",
    a: "Send the whole list rather than one item. Boise Handyman Co is built for multi-item visits, and grouping repairs into a single trip is what keeps a small job worth doing for you and for us.",
  },
};

/** Look up a variant by URL segment; null for the generic /quote page. */
export function serviceBySlug(slug: string | undefined): QuoteService | null {
  if (!slug) return null;
  return QUOTE_SERVICES.find((s) => s.slug === slug) ?? null;
}

/** Slugs Next should prerender. */
export function serviceSlugs(): string[] {
  return QUOTE_SERVICES.map((s) => s.slug);
}
