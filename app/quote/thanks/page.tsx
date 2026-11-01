import {withBrandPageMetadata} from '@/lib/brand-page-metadata';
import type { Metadata } from "next";
import Link from "next/link";

import "../quote.css";
import ThanksMessage from "../ThanksMessage";
import SiteChrome from "@/components/SiteChrome";

/**
 * Quote confirmation.
 *
 * This page deliberately contains no conversion logic. A conversion is sent
 * only in the successful intake callback, never because this URL was opened.
 */

export const metadata: Metadata = withBrandPageMetadata(({
  title: "Your quote request is in | P5 Home Co",
  description: "We have your project details and the right P5 specialist team will be in touch.",
  alternates: { canonical: "/quote/thanks" },
  robots: { index: false, follow: true },
}), "/quote/thanks");

export default function QuoteThanksPage() {
  return (
    <SiteChrome main>
      <div className="quote-page quote-thanks">
        <section className="quote-thanks-body">
          <div className="quote-shell">
            <ThanksMessage />

            <p className="quote-footer-links">
              <Link href="/">Back to P5 Home Co</Link>
              <Link href="/#companies">Meet the five companies</Link>
            </p>
          </div>
        </section>
      </div>
    </SiteChrome>
  );
}
