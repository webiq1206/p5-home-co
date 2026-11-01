import type { Metadata } from "next";
import Link from "next/link";
import SiteChrome from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Page not found | P5 Home Co",
  robots: { index: false, follow: true },
};

/**
 * Missing URLs used to fall through to the framework's bare "404" screen with
 * no header, brand or way back (design audit, 2026-10-17). The root layout
 * renders bare children, so this page sits inside the shared family header
 * and footer (components/SiteChrome.tsx) like every other public page.
 */
export default function NotFound() {
  return (
    <SiteChrome main>
      <div className="content-shell sitemap-main">
        <p className="eyebrow">Page not found</p>
        <h1 className="sitemap-title">That page is not here.</h1>
        <p className="sitemap-lede">
          The link may be out of date, or the address may have a typo. Everything on this site is one step away below.
        </p>
        <section className="sitemap-section" aria-labelledby="not-found-links">
          <h2 id="not-found-links" className="eyebrow">Start here</h2>
          <ul className="sitemap-list">
            <li><Link href="/">Home</Link></li>
            <li><Link href="/quote">Request a quote</Link></li>
            <li><Link href="/estimate">Online project estimator</Link></li>
            <li><Link href="/#companies">Our companies</Link></li>
            <li><Link href="/sitemap">Site map</Link></li>
            <li><a href="tel:+12084771169">Call (208) 477-1169</a></li>
          </ul>
        </section>
      </div>
    </SiteChrome>
  );
}
