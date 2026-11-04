import {withBrandPageMetadata} from '@/lib/brand-page-metadata';
import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "../site.ts";
import { childSites, legalPages, ownPages } from "../siteUrls.ts";
import SiteChrome from "@/components/SiteChrome";

const DESCRIPTION = "Every page on p5homeco.com, and a direct link to each of the five P5 Home Co companies.";

export const metadata: Metadata = withBrandPageMetadata(({
  title: "Site Map | P5 Home Co",
  description: DESCRIPTION,
  alternates: { canonical: "/sitemap" },
  openGraph: { title: "Site Map | P5 Home Co", description: DESCRIPTION, url: `${siteUrl}/sitemap`, type: "website" },
}), "/sitemap");

/**
 * The HTML sitemap: a live, followed crawl path, inside the shared family
 * header and footer (components/SiteChrome.tsx) like every other public page.
 */
export default function SitemapPage() {
  return (
    <SiteChrome main>
      <div className="content-shell sitemap-main">
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
          <h2 id="sitemap-companies" className="eyebrow">{"Our five\u00A0companies"}</h2>
          <ul className="sitemap-list">
            {childSites.map((c) =>
              c.comingSoon ? (
                <li key={c.href} className="sitemap-soon"><Link href="/quote/adu">{c.label}</Link></li>
              ) : (
                <li key={c.href}><a href={c.href}>{c.label}</a></li>
              ),
            )}
          </ul>
        </section>
      </div>
    </SiteChrome>
  );
}
