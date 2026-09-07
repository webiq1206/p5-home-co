import type { Metadata } from "next";
import Link from "next/link";

import "../quote.css";
import ThanksMessage from "../ThanksMessage";

/* eslint-disable @next/next/no-img-element */

/**
 * Quote confirmation.
 *
 * This page deliberately contains no conversion logic. A conversion is sent
 * only in the successful intake callback, never because this URL was opened.
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
          <img src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co, The Home Company" />
        </Link>
        <a className="quote-header-phone" href="tel:+12084771169">
          (208) 477-1169
        </a>
      </header>

      <section className="quote-thanks-body">
        <div className="quote-shell">
          <ThanksMessage />

          <p className="quote-footer-links">
            <Link href="/">Back to P5 Home Co</Link>
            <Link href="/#companies">Meet the five companies</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
