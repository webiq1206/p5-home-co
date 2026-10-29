import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";

/**
 * Phase 4 / D5: the multi-step public estimator is retired. Keep /estimate as a
 * stable inbound URL and send visitors to the short request form on /quote.
 */
export const metadata: Metadata = withBrandPageMetadata({
  title: { absolute: "Request a Quote | P5 Home Co" },
  description:
    "Request a written quote for a Treasure Valley home project. Tell P5 Home Co what you need and the right specialist team follows up within one business day.",
  alternates: { canonical: "https://p5homeco.com/quote" },
  robots: { index: false, follow: true },
}, "/estimate");

export default function EstimatePage() {
  redirect("/quote");
}
