import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { citiesServed, companies, faqs, gaMeasurementId, siteUrl } from "./site";

const title = "P5 Home Co | Five Specialized Home-Service Companies";
const description =
  "P5 Home Co is the parent company behind Boise Construction Co, Boise Remodeling Co, Boise ADU Co, Boise Handyman Co, and Boise Cabinet Co, serving Idaho's Treasure Valley.";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF6" },
    { media: "(prefers-color-scheme: dark)", color: "#17211C" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#20231F" }],
  },
  manifest: "/site.webmanifest",
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
      slogan: "One home. Five specialized teams.",
      foundingDate: "2020",
      telephone: "+1-208-477-1169",
      image: `${siteUrl}/images/p5-og.jpg`,
      logo: { "@type": "ImageObject", url: `${siteUrl}/android-chrome-512x512.png` },
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
      // The premise of the site: five specialist companies under one parent.
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
        "Accessory dwelling units",
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
      "@type": ["WebPage", "FAQPage"],
      "@id": `${siteUrl}/#webpage`,
      url: siteUrl,
      name: title,
      description,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      primaryImageOfPage: `${siteUrl}/images/p5-og.jpg`,
      inLanguage: "en-US",
      // Rendered verbatim in the FAQ section from the same source.
      mainEntity: faqs.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Next preloads the hero and the logo marks on its own, but not the
            fonts, and the hero headline is set in the display serif. */}
        <link rel="preload" as="font" type="font/woff2" href="/fonts/p5-serif.woff2" crossOrigin="anonymous" />
        <link rel="preload" as="font" type="font/woff2" href="/fonts/p5-sans.woff2" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
        {/* Analytics runs in production only, so local development never
            reports into the property. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaMeasurementId}');`}
            </Script>
          </>
        )}
        {children}
      </body>
    </html>
  );
}
