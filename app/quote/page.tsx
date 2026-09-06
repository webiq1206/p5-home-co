import type { Metadata } from "next";
import Link from "next/link";

import { companies, siteUrl } from "../site";
import QuoteForm from "./QuoteForm";
import "./quote.css";

/* eslint-disable @next/next/no-img-element */

const title = "Request a Free Home Project Quote | P5 Home Co";
const description =
  "Get a free, no-obligation quote for a remodel, custom home, ADU, cabinetry, or repair anywhere in Idaho's Treasure Valley. One form reaches the right P5 specialist team.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/quote" },
  openGraph: {
    type: "website",
    siteName: "P5 Home Co",
    title,
    description,
    url: "/quote",
    locale: "en_US",
    images: [
      { url: "/images/p5-og.jpg", width: 1200, height: 630, alt: "P5 Home Co, The Home Company" },
    ],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/images/p5-og.jpg"] },
  robots: { index: true, follow: true },
};

/**
 * Questions specific to asking for a price, deliberately not repeating the
 * homepage FAQ. Both the visible section and the FAQPage schema render from
 * this one list, so the structured data can never claim an answer the page
 * does not show.
 */
const quoteFaqs = [
  {
    q: "How much does a quote cost?",
    a: "Nothing. Quotes and estimates from the P5 companies are free and carry no obligation to proceed. You are not charged for a site visit or for a written scope.",
  },
  {
    q: "How quickly will someone get back to me?",
    a: "Your request is routed to the right company the moment it arrives, and a specialist follows up during business hours. If the work is urgent, call (208) 477-1169 instead of using the form.",
  },
  {
    q: "Which P5 company will handle my project?",
    a: "You do not have to decide. Choose the work you want done and P5 routes it: new homes to Boise Construction Co, renovations and additions to Boise Remodeling Co, accessory dwellings to Boise ADU Co, cabinetry to Boise Cabinet Co, and repairs to Boise Handyman Co. A project that needs more than one company is coordinated between them without sending you back to the start.",
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

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/quote#webpage`,
      url: `${siteUrl}/quote`,
      name: title,
      description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      inLanguage: "en-US",
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${siteUrl}/quote#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "P5 Home Co", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Request a quote", item: `${siteUrl}/quote` },
      ],
    },
    {
      "@type": "Service",
      "@id": `${siteUrl}/quote#service`,
      name: "Free home project quotes",
      serviceType: "Residential construction, remodeling, and repair estimates",
      description:
        "Free, no-obligation quotes for new home construction, remodeling, additions, accessory dwelling units, custom cabinetry, and home repair across the Treasure Valley.",
      provider: { "@id": `${siteUrl}/#organization` },
      areaServed: [
        { "@type": "AdministrativeArea", name: "Ada County, Idaho" },
        { "@type": "AdministrativeArea", name: "Canyon County, Idaho" },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "P5 Home Co companies",
        itemListElement: companies.map((company) => ({
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: company.name,
            description: company.description,
          },
        })),
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${siteUrl}/quote#faq`,
      mainEntity: quoteFaqs.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

const steps = [
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

export default function QuotePage() {
  return (
    <main className="quote-page" id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <header className="quote-header">
        <Link className="quote-wordmark" href="/" aria-label="P5 Home Co, home">
          <img src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co — The Home Company" />
        </Link>
        <a
          className="quote-header-phone"
          href="tel:+12084771169"
          aria-label="Call P5 Home Co on 2 0 8, 4 7 7, 1 1 6 9"
        >
          (208) 477-1169
        </a>
      </header>

      <section className="quote-hero">
        <div className="quote-shell quote-hero-grid">
          <div className="quote-hero-copy">
            <p className="quote-eyebrow">Free quote · Treasure Valley, Idaho</p>
            <h1>Request a free quote for your home project</h1>

            {/* The direct answer: the whole proposition before any preamble. */}
            <p className="quote-lead">
              Tell us what you want done and P5 Home Co sends it to the right specialist team, whether
              that is a kitchen remodel, a custom home, an ADU, new cabinetry, or a repair. Quotes are
              free, carry no obligation, and come with a written scope so you can compare them
              properly.
            </p>

            <ul className="quote-trust" aria-label="Why homeowners work with P5">
              <li>Bonded and insured</li>
              <li>Idaho contractor registration 8381215</li>
              <li>Working across the Valley since 2020</li>
              <li>Five specialist teams, one point of contact</li>
            </ul>

            <p className="quote-hero-call">
              Prefer to talk it through?{" "}
              <a href="tel:+12084771169">Call (208) 477-1169</a>
            </p>
          </div>

          <div className="quote-form-panel">
            <h2 id="quote-form-heading">Tell us about your project</h2>
            <QuoteForm />
          </div>
        </div>
      </section>

      <section className="quote-steps" aria-labelledby="what-happens">
        <div className="quote-shell">
          <h2 id="what-happens">What happens after you send this</h2>
          <ol className="quote-step-grid">
            {steps.map((step) => (
              <li key={step.n}>
                <b aria-hidden="true">{step.n}</b>
                <h3>{step.h}</h3>
                <p>{step.p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="quote-companies" aria-labelledby="who-does-the-work">
        <div className="quote-shell">
          <h2 id="who-does-the-work">Who actually does the work</h2>
          <p className="quote-section-lead">
            P5 Home Co is an operating family of five companies, not a directory or a referral
            network. Each one has its own craft and team, and each does the work itself under one
            shared standard.{" "}
            <Link href="/#p5-standard">Read the P5 standard</Link>.
          </p>
          <ul className="quote-company-list">
            {companies.map((company) => (
              <li key={company.name}>
                <h3>{company.name}</h3>
                <p>{company.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="quote-faq" aria-labelledby="quote-questions">
        <div className="quote-shell">
          <h2 id="quote-questions">Questions about getting a quote</h2>
          <dl>
            {quoteFaqs.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="quote-footer">
        <div className="quote-shell">
          <p className="quote-footer-brand">P5 Home Co</p>
          <p>
            Serving Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden City
            across Ada and Canyon counties.
          </p>
          <p className="quote-footer-links">
            <a href="tel:+12084771169">(208) 477-1169</a>
            <a href="mailto:hello@p5homeco.com">hello@p5homeco.com</a>
            <Link href="/">P5 Home Co home</Link>
            <Link href="/legal/privacy">Privacy policy</Link>
          </p>
          <p className="quote-footer-bottom">© 2026 P5 Home Co. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
