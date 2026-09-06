import type { Metadata } from "next";
import Link from "next/link";

import "../quote.css";

/* eslint-disable @next/next/no-img-element */

/**
 * Quote confirmation.
 *
 * This URL is the conversion destination for Google Ads and GA4: reaching it
 * means a lead was accepted by /api/leads/intake, so it must never be shown
 * for a failed submission. It is noindex because a confirmation page has no
 * business in search results, which does not stop Ads counting a visit to it.
 */

export const metadata: Metadata = {
  title: "Your quote request is in | P5 Home Co",
  description: "We have your project details and the right P5 specialist team will be in touch.",
  alternates: { canonical: "/quote/thanks" },
  robots: { index: false, follow: true },
};

export default function QuoteThanksPage() {
  return (
    <main className="quote-page quote-thanks">
      <header className="quote-header">
        <Link className="quote-wordmark" href="/" aria-label="P5 Home Co, home">
          <img src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co — The Home Company" />
        </Link>
        <a className="quote-header-phone" href="tel:+12084771169">
          (208) 477-1169
        </a>
      </header>

      <section className="quote-thanks-body">
        <div className="quote-shell">
          <p className="quote-eyebrow">Request received</p>
          <h1>Thank you — your request is with the right team</h1>
          <p className="quote-lead">
            We have your project details. Your request has been routed to the P5 company whose craft
            matches the work, and a specialist will follow up during business hours.
          </p>

          <h2>What happens next</h2>
          <ol className="quote-thanks-steps">
            <li>A specialist from the right company reviews what you sent.</li>
            <li>They call or email you to fill in the gaps and, where it helps, arrange a site visit.</li>
            <li>You receive a written scope setting out what is included, what is not, and the cost.</li>
          </ol>

          <p className="quote-thanks-urgent">
            Need it sooner, or remembered something important?{" "}
            <a href="tel:+12084771169">Call (208) 477-1169</a> or email{" "}
            <a href="mailto:hello@p5homeco.com">hello@p5homeco.com</a> and reference your name.
          </p>

          <p className="quote-footer-links">
            <Link href="/">Back to P5 Home Co</Link>
            <Link href="/#companies">Meet the five companies</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
