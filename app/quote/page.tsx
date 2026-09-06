import type { Metadata } from "next";

import QuoteLanding from "./QuoteLanding";
import "./quote.css";

/**
 * The generic quote page.
 *
 * This is the fallback destination and the one that ranks organically. Paid
 * traffic should point at the /quote/<service> variant matching the ad group,
 * because a headline that repeats the search converts far better than one
 * that opens by explaining a corporate structure.
 */

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

export default function QuotePage() {
  return <QuoteLanding service={null} />;
}
