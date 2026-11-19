import type { Metadata } from "next";
import Link from "next/link";
import { FamilyButton } from "@/components/family/Button";
import SiteChrome from "@/components/SiteChrome";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";
import {
  P5_GBP_MAP_EMBED_URL,
  P5_GBP_MAPS_URL,
  PUBLIC_EMAIL,
  PUBLIC_PHONE_DISPLAY,
  PUBLIC_PHONE_SMS,
  PUBLIC_ADDRESS,
  PUBLIC_PHONE_TEL,
} from "../publicIdentity";
import { serializeJsonLd } from "../structuredData";
import { ContactChat } from "./ContactChat";
import {
  BRAND_CONTACT_LINKS,
  CONTACT_DESCRIPTION,
  CONTACT_FAQS,
  CONTACT_HOURS,
  CONTACT_LEAD,
  CONTACT_LINKS,
  CONTACT_TITLE,
  contactPageSchema,
} from "./content";

export const metadata: Metadata = withBrandPageMetadata(
  {
    title: { absolute: CONTACT_TITLE },
    description: CONTACT_DESCRIPTION,
    alternates: { canonical: "/contact" },
    openGraph: {
      type: "website",
      siteName: "P5 Home Co",
      title: CONTACT_TITLE,
      description: CONTACT_DESCRIPTION,
      url: "/contact",
      locale: "en_US",
    },
    robots: { index: true, follow: true },
  },
  "/contact",
);

const URL_PATTERN = /https:\/\/p5homeco\.com\/[A-Za-z0-9/_-]*/g;

/** Prints an answer unchanged, with each site URL as a link whose text is the URL. */
function Answer({ text }: { text: string }) {
  const nodes: Array<string | { href: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push({ href: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return (
    <p>
      {nodes.map((node, index) =>
        typeof node === "string" ? (
          node
        ) : (
          <a key={index} href={node.href.replace("https://p5homeco.com", "") || "/"}>
            {node.href}
          </a>
        ),
      )}
    </p>
  );
}

export default function ContactPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(contactPageSchema) }} />
      <div className="about-page contact-page">
        <SiteChrome main>
          <section className="about-hero" aria-labelledby="contact-heading">
            <div className="content-shell about-hero-inner">
              <nav className="about-breadcrumb" aria-label="Breadcrumb">
                <ol>
                  <li>
                    <Link href="/">Home</Link>
                  </li>
                  <li aria-current="page">Contact</li>
                </ol>
              </nav>
              <p className="eyebrow">Contact</p>
              <h1 id="contact-heading">Contact P5 Home Co</h1>
              <p className="about-answer">{CONTACT_LEAD}</p>
              <div className="contact-actions">
                <FamilyButton href={PUBLIC_PHONE_TEL} size="lg" aria-label={`Call ${PUBLIC_PHONE_DISPLAY}`}>
                  Call
                </FamilyButton>
                <FamilyButton href={PUBLIC_PHONE_SMS} variant="secondary" size="lg" aria-label={`Text ${PUBLIC_PHONE_DISPLAY}`}>
                  Text
                </FamilyButton>
                <ContactChat />
              </div>
            </div>
          </section>

          <section className="contact-panel" aria-labelledby="contact-hours">
            <div className="content-shell contact-grid">
              <div className="contact-card">
                <address className="contact-nap">
                  <p className="contact-nap-name">P5 Home Co</p>
                  <p>{PUBLIC_ADDRESS}</p>
                  <p>
                    <a href={PUBLIC_PHONE_TEL}>{PUBLIC_PHONE_DISPLAY}</a>
                  </p>
                  <p>
                    <a href={`mailto:${PUBLIC_EMAIL}`}>{PUBLIC_EMAIL}</a>
                  </p>
                </address>
                <div>
                  <h2 id="contact-hours">Hours</h2>
                  <dl className="contact-hours">
                    {CONTACT_HOURS.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="contact-hours-note">Mountain time.</p>
                </div>
              </div>
              <div className="contact-map-wrap">
                <h2>Service area map</h2>
                <div className="contact-map">
                  <iframe
                    title="P5 Home Co service area map"
                    src={P5_GBP_MAP_EMBED_URL}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    width={640}
                    height={360}
                  />
                </div>
                <p className="contact-map-note">
                  <a href={P5_GBP_MAPS_URL} rel="noopener noreferrer" target="_blank">
                    P5 Home Co on Google Maps
                  </a>
                </p>
              </div>
            </div>
          </section>

          <section className="contact-links" aria-labelledby="contact-start">
            <div className="content-shell contact-link-grid">
              <div>
                <h2 id="contact-start">Start a project</h2>
                <ul>
                  {CONTACT_LINKS.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2>Company contact pages</h2>
                <ul>
                  {BRAND_CONTACT_LINKS.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} rel="noopener noreferrer" target="_blank">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* Same disclosure pattern as the homepage questions: one row per
              question, opened on tap, every answer in the HTML. */}
          <section className="contact-faq" aria-labelledby="contact-questions">
            <div className="content-shell faq-layout">
              <div>
                <h2 id="contact-questions">Common questions</h2>
              </div>
              <div className="faq-list">
                {CONTACT_FAQS.map((item, index) => (
                  <details className="faq-item" key={item.q} open={index === 0}>
                    <summary>
                      <h3>{item.q}</h3>
                    </summary>
                    <Answer text={item.a} />
                  </details>
                ))}
              </div>
            </div>
          </section>
        </SiteChrome>
      </div>
    </>
  );
}
