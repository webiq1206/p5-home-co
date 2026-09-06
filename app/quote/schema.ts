/**
 * Copy and structured data for the quote pages.
 *
 * Pure, with no JSX, so the FAQ composition and the JSON-LD can be tested
 * directly - the test runner strips types but cannot compile JSX, so anything
 * worth asserting has to live outside the component.
 */

import { siteUrl } from "../site.ts";
import { SERVICE_FAQ, type QuoteService } from "./services.ts";

export interface Faq {
  readonly q: string;
  readonly a: string;
}

/** Questions about getting a price, shared by every variant. */
export const SHARED_FAQ: readonly Faq[] = [
  {
    q: "How much does a quote cost?",
    a: "Nothing. Quotes and estimates from the P5 companies are free and carry no obligation to proceed. You are not charged for a site visit or for a written scope.",
  },
  {
    q: "How quickly will someone get back to me?",
    a: "Your request is routed to the right company the moment it arrives, and a specialist follows up during business hours. If the work is urgent, call (208) 477-1169 instead of using the form.",
  },
  {
    q: "Do I need to know my budget before asking?",
    a: "No. Send what you know and leave the rest blank. Talking through rough numbers early is part of the first conversation, and it is how a scope gets shaped to fit a budget rather than the other way round.",
  },
  {
    q: "Which areas do the P5 companies serve?",
    a: "Homeowners across Ada and Canyon counties in Idaho's Treasure Valley, including Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden City.",
  },
] as const;

export const STEPS = [
  {
    n: "01",
    h: "We read it and route it",
    p: "Your request goes to the P5 company whose craft matches the work, so the first person who calls already knows the job.",
  },
  {
    n: "02",
    h: "A specialist follows up",
    p: "You talk to someone who does this work, not a call centre. Where a site visit helps, we arrange one.",
  },
  {
    n: "03",
    h: "You get it in writing",
    p: "A written scope sets out what is included, what is not, and what it costs, so you can compare it properly.",
  },
] as const;

export const GENERIC_TITLE = "Request a Free Home Project Quote | P5 Home Co";
export const GENERIC_DESCRIPTION =
  "Get a free, no-obligation quote for a remodel, custom home, ADU, cabinetry, or repair anywhere in Idaho's Treasure Valley. One form reaches the right P5 specialist team.";

/** The service question first, so no two quote pages ship an identical FAQ. */
export function faqsFor(service: QuoteService | null): readonly Faq[] {
  const specific = service ? SERVICE_FAQ[service.slug] : undefined;
  return specific ? [specific, ...SHARED_FAQ] : SHARED_FAQ;
}

export function pathFor(service: QuoteService | null): string {
  return service ? `/quote/${service.slug}` : "/quote";
}

export function schemaFor(service: QuoteService | null): Record<string, unknown> {
  const path = pathFor(service);
  const url = `${siteUrl}${path}`;
  const name = service ? service.metaTitle : GENERIC_TITLE;
  const description = service ? service.metaDescription : GENERIC_DESCRIPTION;

  const itemListElement: Record<string, unknown>[] = [
    { "@type": "ListItem", position: 1, name: "P5 Home Co", item: siteUrl },
    { "@type": "ListItem", position: 2, name: "Request a quote", item: `${siteUrl}/quote` },
  ];
  if (service) {
    itemListElement.push({
      "@type": "ListItem",
      position: 3,
      name: service.label,
      item: url,
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name,
        description,
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@id": `${siteUrl}/#organization` },
        inLanguage: "en-US",
      },
      { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement },
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: service ? service.label : "Free home project quotes",
        serviceType: service
          ? service.label
          : "Residential construction, remodeling, and repair estimates",
        description,
        provider: { "@id": `${siteUrl}/#organization` },
        areaServed: [
          { "@type": "AdministrativeArea", name: "Ada County, Idaho" },
          { "@type": "AdministrativeArea", name: "Canyon County, Idaho" },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: faqsFor(service).map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}
