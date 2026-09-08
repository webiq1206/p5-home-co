import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "../site.ts";
import { childSites, legalPages, ownPages } from "../siteUrls.ts";

const DESCRIPTION = "Every page on p5homeco.com, and a direct link to each of the five P5 Home Co companies.";

export const metadata: Metadata = {
  title: "Site Map | P5 Home Co",
  description: DESCRIPTION,
  alternates: { canonical: "/sitemap" },
  openGraph: { title: "Site Map | P5 Home Co", description: DESCRIPTION, url: `${siteUrl}/sitemap`, type: "website" },
};

/**
 * The HTML sitemap: a live, followed crawl path. The root layout renders bare
 * children (the homepage draws its own header and footer), so this page carries
 * a minimal wordmark header and footer in the site's own classes.
 */
export default function SitemapPage() {
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
        <p className="eyebrow">Site map</p>
        <h1 className="sitemap-title">Everything on this site, in one place.</h1>
        <p className="sitemap-lede">{DESCRIPTION}</p>

        <section className="sitemap-section" aria-labelledby="sitemap-pages">
          <h2 id="sitemap-pages" className="eyebrow">This site</h2>
          <ul className="sitemap-list">
            {ownPages.map((p) => (
              <li key={p.href}><Link href={p.href}>{p.label}</Link></li>
            ))}
          </ul>
        </section>

        <section className="sitemap-section" aria-labelledby="sitemap-legal">
          <h2 id="sitemap-legal" className="eyebrow">Legal</h2>
          <ul className="sitemap-list">
            {legalPages.map((p) => (
              <li key={p.href}><Link href={p.href}>{p.label}</Link></li>
            ))}
          </ul>
        </section>

        <section className="sitemap-section" aria-labelledby="sitemap-companies">
          <h2 id="sitemap-companies" className="eyebrow">Our five companies</h2>
          <ul className="sitemap-list">
            {childSites.map((c) =>
              c.comingSoon ? (
                <li key={c.href} className="sitemap-soon">{c.label} <small>(launching soon)</small></li>
              ) : (
                <li key={c.href}><a href={c.href}>{c.label}</a></li>
              ),
            )}
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <div className="content-shell footer-bottom">
          <span>© {new Date().getFullYear()} P5 Home Co. All rights reserved.</span>
          <span><Link href="/">Home</Link></span>
        </div>
      </footer>
    </>
  );
}
