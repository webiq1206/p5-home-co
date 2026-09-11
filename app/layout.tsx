import type { Metadata, Viewport } from "next";
import Script from "next/script";
import HubSpotScript from "./HubSpotScript";
import MobileActionBar from "@/components/MobileActionBar";
import "./globals.css";
import { gaMeasurementId, googleAdsDestinationId, siteUrl } from "./site";
import { serializeJsonLd, siteDescription, siteSchema, siteTitle } from "./structuredData";

const title = siteTitle;
const description = siteDescription;

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
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteSchema) }}
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
gtag('config', '${gaMeasurementId}');
gtag('config', '${googleAdsDestinationId}');`}
            </Script>
          </>
        )}
        {process.env.NODE_ENV === "production" && <HubSpotScript />}
        {children}
        <MobileActionBar />
      </body>
    </html>
  );
}
