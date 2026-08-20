import type { Metadata } from "next";
import "./globals.css";
import { citiesServed, companies, siteUrl } from "./site";

const title = "P5 Home Co | Four Expert Home-Service Companies";
const description =
  "P5 Home Co is the parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, and Boise Handyman Co, serving Idaho's Treasure Valley.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    type: "website",
    siteName: "P5 Home Co",
    title,
    description,
    url: "/",
    locale: "en_US",
    images: [
      {
        url: "/images/p5-og.jpg",
        width: 1200,
        height: 630,
        alt: "P5 Home Co, The Home Company",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/p5-og.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

// Every claim below is stated on the page itself. Nothing is asserted here
// that a visitor cannot also read, which is what keeps the structured data
// valid. Note there is no streetAddress and no aggregateRating, because
// neither appears on the site.
const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Organization", "HomeAndConstructionBusiness"],
      "@id": `${siteUrl}/#organization`,
      name: "P5 Home Co",
      alternateName: "P5 Home Company",
      url: siteUrl,
      description,
      slogan: "One home. Four specialized teams.",
      foundingDate: "2020",
      telephone: "+1-208-477-1169",
      image: `${siteUrl}/images/p5-og.jpg`,
      logo: { "@type": "ImageObject", url: `${siteUrl}/favicon.svg` },
      address: {
        "@type": "PostalAddress",
        addressLocality: "Boise",
        addressRegion: "ID",
        addressCountry: "US",
      },
      areaServed: [
        { "@type": "AdministrativeArea", name: "Ada County, Idaho" },
        { "@type": "AdministrativeArea", name: "Canyon County, Idaho" },
        ...citiesServed.map((name) => ({
          "@type": "City",
          name,
          address: {
            "@type": "PostalAddress",
            addressLocality: name,
            addressRegion: "ID",
            addressCountry: "US",
          },
        })),
      ],
      // The premise of the site: four specialist companies under one parent.
      subOrganization: companies.map((company) => ({
        "@type": "Organization",
        "@id": `${company.url}/#organization`,
        name: company.name,
        url: company.url,
        description: company.description,
        parentOrganization: { "@id": `${siteUrl}/#organization` },
      })),
      knowsAbout: [
        "Custom home building",
        "Design-build remodeling",
        "Custom cabinetry",
        "Home repair and maintenance",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "P5 Home Co",
      description,
      publisher: { "@id": `${siteUrl}/#organization` },
      inLanguage: "en-US",
    },
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/#webpage`,
      url: siteUrl,
      name: title,
      description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      primaryImageOfPage: `${siteUrl}/images/p5-og.jpg`,
      inLanguage: "en-US",
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
        {children}
      </body>
    </html>
  );
}
