import type { Metadata } from "next";
import Link from "next/link";
import { withBrandPageMetadata } from "@/lib/brand-page-metadata";
import AboutClient from "./AboutClient";
import { serializeJsonLd } from "../structuredData";
import {
  CONTRACTOR_REGISTRATION,
  IDAHO_DOPL_LICENSE_SEARCH,
  NICK_PERKINS_ID,
  PUBLIC_REPRESENTATIVE,
  SCHEMA_LEGAL_NAME,
  SCHEMA_TELEPHONE,
} from "../publicIdentity";
import { siteUrl } from "../site";

const title = "About P5 Home Co | Nick Perkins, Founder | Meridian, Idaho";
const description =
  "About P5 Home Co: founder Nick Perkins, a construction project manager and father of five, and the four Treasure Valley companies that carry his name.";

export const metadata: Metadata = withBrandPageMetadata(
  {
    title: { absolute: title },
    description,
    alternates: { canonical: "/about" },
    openGraph: {
      type: "website",
      siteName: "P5 Home Co",
      title,
      description,
      url: "/about",
      locale: "en_US",
      images: [
        {
          url: "/images/about/perkins-family-meridian-idaho-1x1.webp",
          width: 2048,
          height: 2048,
          alt: "Nick Perkins with his wife and five children at a pumpkin patch in Meridian, Idaho",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/about/perkins-family-meridian-idaho-1x1.webp"],
    },
    robots: { index: true, follow: true },
  },
  "/about",
);

const aboutSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${siteUrl}/about#webpage`,
      url: `${siteUrl}/about`,
      name: title,
      description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      mainEntity: { "@id": NICK_PERKINS_ID },
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: [".about-answer", ".about-family-drive"],
      },
    },
    {
      "@type": "Person",
      "@id": NICK_PERKINS_ID,
      name: PUBLIC_REPRESENTATIVE,
      jobTitle: "Founder",
      worksFor: {
        "@type": "Organization",
        name: "P5 Home Co",
        legalName: SCHEMA_LEGAL_NAME,
        url: siteUrl,
      },
      telephone: SCHEMA_TELEPHONE,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Meridian",
        addressRegion: "ID",
        addressCountry: "US",
      },
      description:
        "Founder of P5 Home Co. Construction project manager, husband, and father of five in Meridian, Idaho.",
      image: `${siteUrl}/images/about/perkins-family-meridian-idaho-1x1.webp`,
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "About", item: `${siteUrl}/about` },
      ],
    },
  ],
};

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutSchema) }}
      />
      <AboutClient doplLookup={IDAHO_DOPL_LICENSE_SEARCH} registration={CONTRACTOR_REGISTRATION} />
      <noscript>
        <p>
          <Link href="/quote">Request a quote</Link>
        </p>
      </noscript>
    </>
  );
}
