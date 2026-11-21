import { officeOpeningHours } from "../lib/businessHours.ts";
import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";
import {
  NICK_PERKINS_ID,
  PUBLIC_REPRESENTATIVE,
  SCHEMA_LEGAL_NAME,
  SCHEMA_TELEPHONE,
  CONTRACTOR_REGISTRATION,
  P5_FACEBOOK_URL,
  P5_INSTAGRAM_URL,
  P5_GOOGLE_BUSINESS_PROFILE_URL,
  P5_GBP_MAPS_URL,
  P5_BBB_URL,
  PUBLIC_ADDRESS_LOCALITY,
  PUBLIC_ADDRESS_REGION,
  PUBLIC_POSTAL_CODE,
} from "./publicIdentity.ts";
import { SHOW_FOUNDING_YEAR } from "./publicClaims.ts";
import { citiesServed, companies, faqs, siteUrl } from "./site.ts";

// Parent-brand title (owner, 20 November 2026): the trade searches belong to
// the four brand homepages, so this one names P5 and its role.
export const siteTitle = "P5 Home Co | Five Treasure Valley home companies";
export const siteDescription =
  "Parent company of Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co in Idaho's Treasure Valley.";

/** Entities that describe the publisher and website on every public page. */
export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Organization", "GeneralContractor"],
      "@id": `${siteUrl}/#organization`,
      name: "P5 Home Co",
      legalName: SCHEMA_LEGAL_NAME,
      alternateName: "P5 Home Company",
      url: siteUrl,
      description: siteDescription,
      slogan: "One home. Five specialized teams.",
      ...(SHOW_FOUNDING_YEAR ? { foundingDate: "2020" } : {}),
      telephone: SCHEMA_TELEPHONE,
      email: ESTIMATOR_BRAND.email,
      image: `${siteUrl}/images/p5-og.jpg`,
      logo: { "@type": "ImageObject", url: `${siteUrl}/android-chrome-512x512.png` },
      // Parent profiles only. The brand nodes have none of their own.
      sameAs: [P5_FACEBOOK_URL, P5_INSTAGRAM_URL, P5_GOOGLE_BUSINESS_PROFILE_URL, P5_GBP_MAPS_URL, P5_BBB_URL],
      employee: {
        "@type": "Person",
        "@id": NICK_PERKINS_ID,
        name: PUBLIC_REPRESENTATIVE,
        jobTitle: "Founder",
        worksFor: { "@id": `${siteUrl}/#organization` },
      },
      openingHoursSpecification: officeOpeningHours(),
      contactPoint: {
        "@type": "ContactPoint",
        name: PUBLIC_REPRESENTATIVE,
        contactType: "customer service",
        telephone: SCHEMA_TELEPHONE,
        areaServed: "US-ID",
        availableLanguage: "English",
      },
      hasCredential: {
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "registration",
        identifier: CONTRACTOR_REGISTRATION,
        name: "Idaho Registered Contractor",
        recognizedBy: {
          "@type": "GovernmentOrganization",
          name: "Idaho Division of Occupational and Professional Licenses",
          url: "https://dopl.idaho.gov/con/",
        },
      },
      address: {
        "@type": "PostalAddress",
        addressLocality: PUBLIC_ADDRESS_LOCALITY,
        addressRegion: PUBLIC_ADDRESS_REGION,
        postalCode: PUBLIC_POSTAL_CODE,
        addressCountry: "US",
      },
      // Rounded to 3 decimals so the point names Meridian, not one house.
      geo: {
        "@type": "GeoCoordinates",
        latitude: 43.652,
        longitude: -116.444,
      },
      areaServed: [
        { "@type": "AdministrativeArea", name: "Ada County, Idaho" },
        { "@type": "AdministrativeArea", name: "Canyon County, Idaho" },
        ...citiesServed.map((name) => ({
          "@type": "City",
          name,
        })),
      ],
      // One node per company. Boise ADU Co has no site yet, so its url is the
      // P5 ADU request. That url is its own @id.
      subOrganization: companies.map((company) => {
        const url = company.url.startsWith("http") ? company.url : `${siteUrl}${company.url}`;
        return {
          "@type": "Organization",
          "@id": `${url}/#organization`,
          name: company.name,
          url,
          description: company.description,
          image: `${siteUrl}${company.image}`,
          parentOrganization: { "@id": `${siteUrl}/#organization` },
        };
      }),
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
      description: siteDescription,
      publisher: { "@id": `${siteUrl}/#organization` },
      inLanguage: "en-US",
    },
  ],
} as const;

/** Homepage-only schema. Keep this beside the visible homepage FAQ. */
export const homePageSchema = {
  "@context": "https://schema.org",
  "@type": ["WebPage", "FAQPage"],
  "@id": `${siteUrl}/#webpage`,
  url: siteUrl,
  name: siteTitle,
  description: siteDescription,
  isPartOf: { "@id": `${siteUrl}/#website` },
  about: { "@id": `${siteUrl}/#organization` },
  primaryImageOfPage: `${siteUrl}/images/p5-og.jpg`,
  inLanguage: "en-US",
  mainEntity: faqs.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
} as const;

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Home > page, for a page with no visible breadcrumb trail of its own (document pages; audit P5-T3). */
export function breadcrumbSchema(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${siteUrl}${path}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name, item: `${siteUrl}${path}` },
    ],
  };
}

/** The breadcrumb as a JSON-LD script body. */
export function breadcrumbJsonLd(name: string, path: string): string {
  return serializeJsonLd(breadcrumbSchema(name, path));
}
