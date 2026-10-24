import type { Metadata } from "next";
import Link from "next/link";
import PublicIdentity from "@/components/PublicIdentity";

export const metadata: Metadata = {
  title: "Page not found | P5 Home Co",
  robots: { index: false, follow: true },
};

/**
 * Missing URLs used to fall through to the framework's bare "404" screen with
 * no header, brand or way back (design audit, 2026-10-17). The root layout
 * renders bare children, so this page carries the same minimal wordmark
 * header and footer the sitemap page uses.
 */
export default function NotFound() {
  return (
    <>
      <header className="site-header">
        <div className="content-shell site-header-inner">
          <Link className="wordmark" href="/" aria-label="P5 Home Co, back to the homepage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="p5-header-logo" src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co, The Home Company" />
          </Link>
        </div>
      </header>
      <main className="content-shell sitemap-main">
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
      </main>
      <footer className="site-footer">
        <div className="content-shell">
          <PublicIdentity />
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} P5 Home Co. All rights reserved.</span>
            <span><Link href="/">Home</Link></span>
          </div>
        </div>
      </footer>
    </>
  );
}
