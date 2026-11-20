/**
 * Contact page copy and JSON-LD. The FAQ answers are the visible text, so the
 * FAQPage node cannot drift from the page. The service-area answer names the
 * nine service-area cities (owner, 20 November 2026).
 */

import { BUSINESS_HOURS } from "../../lib/businessHours.ts";
import {
  PUBLIC_ADDRESS,
  PUBLIC_EMAIL,
  PUBLIC_PHONE_DISPLAY,
} from "../publicIdentity.ts";
import { cityList } from "../serviceArea.ts";
import { siteUrl } from "../site.ts";

export const CONTACT_PATH = "/contact";
export const CONTACT_TITLE = "Contact P5 Home Co | Meridian, Idaho home companies";
export const CONTACT_DESCRIPTION =
  "Call, text or email P5 Home Co for a free quote on your Treasure Valley home project. Mon to Sat hours, instant estimates online and a written scope first.";

export const CONTACT_LEAD =
  "P5 Home Co answers calls, texts and email for home projects across the Treasure Valley. Write to hello@p5homeco.com, or use the buttons below to call, text or chat with our team. Hours are Monday to Friday, 9 AM to 6 PM, and Saturday, 9 AM to 4 PM Mountain. Sunday is closed.";

function spokenHours(value: string): string {
  return value.split(":00").join("").split(" - ").join(" to ");
}

export const CONTACT_HOURS = [
  { label: "Monday to Friday", value: spokenHours(BUSINESS_HOURS.monday) },
  { label: "Saturday", value: spokenHours(BUSINESS_HOURS.saturday) },
  { label: "Sunday", value: "Closed" },
] as const;

export const CONTACT_LINKS = [
  { href: "/estimator", label: "Get an instant estimate" },
  { href: "/quote", label: "Request a quote" },
  { href: "/quote/adu", label: "Start an ADU request" },
] as const;

export const BRAND_CONTACT_LINKS = [
  { href: "https://boiseconstruction.co/contact", label: "Boise Construction Co" },
  { href: "https://boiseremodeling.co/contact", label: "Boise Remodeling Co" },
  { href: "https://boisecabinet.co/contact", label: "Boise Cabinet Co" },
  { href: "https://boisehandyman.co/contact", label: "Boise Handyman Co" },
] as const;

export interface ContactFaq {
  q: string;
  a: string;
}

export const CONTACT_FAQS: readonly ContactFaq[] = [
  {
    q: "What areas does P5 Home Co serve?",
    a: `Homeowners across Ada and Canyon counties in Idaho's Treasure Valley, including ${cityList()}.`,
  },
  {
    q: "How does the instant estimate work?",
    a: "Pick your project type (remodel, new construction, ADU, cabinetry or handyman), answer a few questions and see a price range on screen. It is free and needs no appointment. When you are ready, request a quote and the right P5 team follows up.",
  },
  {
    q: "Which P5 company handles my project?",
    a: "Boise Construction Co: custom homes and additions. Boise Remodeling Co: kitchens, baths, basements and whole-home remodels. Boise Cabinet Co: cabinets, vanities and built-ins. Boise Handyman Co: repairs and to-do lists. Boise ADU Co: ADUs and garage conversions. You don't need to pick one. A single request to P5 Home Co reaches the right team.",
  },
  {
    q: "Does a quote cost anything?",
    a: "No. Your first conversation and project review are free and carry no obligation. Paid planning, design or feasibility work only starts after you approve its scope and price in writing.",
  },
  {
    q: "Will I get the price in writing?",
    a: "Yes. Every project starts with a written scope that covers what is included, what is not and the price, so you can compare it with other quotes.",
  },
  {
    q: "Can I build an ADU on my lot?",
    a: "It depends on your city, your lot and its setbacks, and the rules differ between Ada and Canyon counties. Boise ADU Co checks what your lot and city allow before anything is designed or priced. Start at https://p5homeco.com/quote/adu.",
  },
  {
    q: "Do I need to know my budget before I ask?",
    a: "No. Send what you know and leave the rest blank. Talking through rough numbers early is part of the first conversation, and it is how the scope gets shaped to fit your budget.",
  },
  {
    q: "What are your hours, and how do I reach you?",
    a: "Monday to Friday, 9 AM to 6 PM, and Saturday, 9 AM to 4 PM Mountain. Closed Sunday. Call or text (208) 477-1169, email hello@p5homeco.com, or request a quote at https://p5homeco.com/quote. For urgent work, call rather than using the form.",
  },
];

const pageUrl = `${siteUrl}${CONTACT_PATH}`;

export const contactPageSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ContactPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: CONTACT_TITLE,
      description: CONTACT_DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      mainEntity: { "@id": `${siteUrl}/#organization` },
      inLanguage: "en-US",
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${pageUrl}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Contact", item: pageUrl },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      isPartOf: { "@id": `${pageUrl}#webpage` },
      mainEntity: CONTACT_FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
} as const;

export function contactLeadWordCount(text: string = CONTACT_LEAD): number {
  return text.trim().split(/\s+/).length;
}

/** Visible NAP, kept here so the page and the tests share one string. */
export const CONTACT_NAP = {
  name: "P5 Home Co",
  address: PUBLIC_ADDRESS,
  phone: PUBLIC_PHONE_DISPLAY,
  email: PUBLIC_EMAIL,
} as const;
