import type { Metadata } from "next";
import Link from "next/link";
import SiteChrome from "@/components/SiteChrome";
import { FamilyButton } from "@/components/family/Button";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";
import { serializeJsonLd } from "../structuredData";
import { PUBLIC_EMAIL, PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_TEL } from "../publicIdentity";
import { HELP_MAILTO } from "./help";
import { siteUrl } from "../site";

/**
 * Warranty and project help (owner decisions D1 and D8, 8 November 2026).
 * Workmanship coverage is one year from documented Final Completion for work
 * performed by our own team; subcontractor work carries that subcontractor's
 * own warranty, and every project ends with a complete subcontractor list and
 * contact information. Structured like the About page and uses its styles.
 */

const title = "Warranty and Project Help | P5 Home Co";
const description =
  "How P5 Home Co workmanship coverage works: one year from documented Final Completion for our own team's work, subcontractor warranties, and how to get help.";

export const metadata: Metadata = withBrandPageMetadata(
  {
    title: { absolute: title },
    description,
    alternates: { canonical: "/warranty" },
    openGraph: { type: "website", siteName: "P5 Home Co", title, description, url: "/warranty", locale: "en_US" },
    robots: { index: true, follow: true },
  },
  "/warranty",
);

const warrantySchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/warranty#webpage`,
      url: `${siteUrl}/warranty`,
      name: title,
      description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Warranty and project help", item: `${siteUrl}/warranty` },
      ],
    },
  ],
};

export default function WarrantyPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(warrantySchema) }} />
      <div id="top" className="about-page">
        <SiteChrome main>
          <section className="about-hero" aria-labelledby="warranty-heading">
            <div className="content-shell about-hero-inner">
              <nav className="about-breadcrumb" aria-label="Breadcrumb">
                <ol>
                  <li>
                    <Link href="/">Home</Link>
                  </li>
                  <li aria-current="page">Warranty</li>
                </ol>
              </nav>
              <p className="eyebrow">Warranty and project help</p>
              <h1 id="warranty-heading">How our workmanship coverage works</h1>
              <p className="about-answer">
                Work performed by our own team carries one year of workmanship coverage from documented Final
                Completion. Work performed by subcontractors is covered by that subcontractor&apos;s own warranty, and
                manufacturer product warranties are separate.
              </p>
              <div className="about-hero-actions">
                <FamilyButton href="#get-help" size="lg" data-cta="primary" data-hero-cta="primary">
                  Get help with a completed project
                </FamilyButton>
                <a className="text-link" href={PUBLIC_PHONE_TEL}>
                  Call {PUBLIC_PHONE_DISPLAY}
                </a>
              </div>
            </div>
          </section>

          <section className="about-section content-shell" aria-labelledby="own-team">
            <h2 id="own-team">Work by our own team</h2>
            <ul>
              <li>
                Work performed by our own team is covered for one year of workmanship from documented Final
                Completion.
              </li>
              <li>
                Final Completion means the agreed work, including any written changes, is complete or resolved in
                writing, required inspections have passed, the systems we worked on are working, the site is cleaned
                up, and the walkthrough and handover records are complete. Your signed agreement holds the controlling
                definition.
              </li>
            </ul>
          </section>

          <section className="about-section content-shell" aria-labelledby="subcontractors">
            <h2 id="subcontractors">Work by subcontractors</h2>
            <ul>
              <li>
                Work performed by subcontractors, for example licensed plumbing, electrical or HVAC work, is covered by
                that subcontractor&apos;s own warranty.
              </li>
              <li>
                At the end of every project we provide a complete list of the subcontractors who worked on it, with
                their contact information.
              </li>
            </ul>
          </section>

          <section className="about-section content-shell" aria-labelledby="manufacturer">
            <h2 id="manufacturer">Manufacturer and product warranties</h2>
            <ul>
              <li>
                Appliances, fixtures, materials and other products carry their manufacturer&apos;s own warranty terms,
                which are separate from our workmanship coverage.
              </li>
              <li>Ten-year structural coverage applies only where your signed agreement offers it.</li>
            </ul>
          </section>

          <section className="about-section content-shell" aria-labelledby="not-covered">
            <h2 id="not-covered">What is not covered</h2>
            <ul>
              <li>Normal wear.</li>
              <li>Misuse.</li>
              <li>Work by others after completion.</li>
            </ul>
          </section>

          <section id="get-help" className="about-section content-shell" aria-labelledby="get-help-heading">
            <h2 id="get-help-heading">Get help with a completed project</h2>
            <ul>
              <li>
                Email or call us and tell us your name, the project address, the affected item and where it is, when it
                started, and what you are seeing. Photos help if you have them.
              </li>
              <li>
                <a href={HELP_MAILTO}>Email {PUBLIC_EMAIL}</a> or call{" "}
                <a href={PUBLIC_PHONE_TEL}>{PUBLIC_PHONE_DISPLAY}</a>. You do not need a portal account or a ticket
                number.
              </li>
              <li>For subcontractor work, we can point you to the right subcontractor from the list.</li>
              <li>
                Your signed agreement sets how formal warranty notice must be given. If it names a notice method, use
                that method for a formal claim.
              </li>
              <li>
                If there is immediate danger, such as a gas smell, an active leak or an electrical hazard, call 911 or
                your utility first, then contact us.
              </li>
            </ul>
          </section>
        </SiteChrome>
      </div>
    </>
  );
}
