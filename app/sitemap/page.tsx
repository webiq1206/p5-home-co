import type { Metadata } from "next";
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
          <a className="wordmark" href="/" aria-label="P5 Home Co, back to the homepage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="p5-header-logo" src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co — The Home Company" />
          </a>
        </div>
      </header>
      <main className="content-shell" style={{ padding: "72px 0 96px", maxWidth: 820 }}>
        <p className="eyebrow">Site map</p>
        <h1 style={{ fontFamily: '"P5 Serif", Georgia, serif', fontWeight: 400, letterSpacing: "-.03em", lineHeight: 1.05, fontSize: "clamp(38px,4.5vw,60px)", margin: "0 0 18px" }}>
          Everything on this site, in one place.
        </h1>
        <p style={{ color: "var(--ink-2)", maxWidth: 620, margin: "0 0 48px" }}>{DESCRIPTION}</p>

        <section aria-labelledby="sitemap-pages" style={{ marginBottom: 44 }}>
          <h2 id="sitemap-pages" className="eyebrow">This site</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {ownPages.map((p) => (
              <li key={p.href}><a href={p.href} style={{ color: "var(--ink)", borderBottom: "1px solid var(--line)" }}>{p.label}</a></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sitemap-legal" style={{ marginBottom: 44 }}>
          <h2 id="sitemap-legal" className="eyebrow">Legal</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {legalPages.map((p) => (
              <li key={p.href}><a href={p.href} style={{ color: "var(--ink)", borderBottom: "1px solid var(--line)" }}>{p.label}</a></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sitemap-companies">
          <h2 id="sitemap-companies" className="eyebrow">Our five companies</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {childSites.map((c) =>
              c.comingSoon ? (
                <li key={c.href} style={{ color: "var(--ink-2)" }}>{c.label} <small>(launching soon)</small></li>
              ) : (
                <li key={c.href}><a href={c.href} style={{ color: "var(--ink)", borderBottom: "1px solid var(--line)" }}>{c.label}</a></li>
              ),
            )}
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <div className="content-shell footer-bottom">
          <span>© {new Date().getFullYear()} P5 Home Co. All rights reserved.</span>
          <span><a href="/" style={{ color: "inherit" }}>Home</a></span>
        </div>
      </footer>
    </>
  );
}
