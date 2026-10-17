import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";
import {
  NICK_PERKINS_ID,
  PUBLIC_ADDRESS,
  PUBLIC_REPRESENTATIVE,
  SCHEMA_LEGAL_NAME,
  SCHEMA_TELEPHONE,
  CONTRACTOR_REGISTRATION,
} from "./publicIdentity.ts";
import { citiesServed, companies, faqs, siteUrl } from "./site.ts";

/** Authorized public contact. The phone, email, and street line match the
 * brand brief, docs/growth/OPERATIONS.md, and the constants already on the
 * site. The street does not make this a staffed storefront. Schema telephone
 * is E.164; the visible pages keep the local format. */
const [streetAddress, addressLocality, regionAndPostal] = PUBLIC_ADDRESS.split(", ");
const [addressRegion, postalCode] = regionAndPostal.split(" ");

export const siteTitle = "P5 Home Co | Five Home-Service Companies in Boise, ID";
export const siteDescription =
  "The parent company behind Boise Construction Co, Boise Remodeling Co, Boise ADU Co, Boise Handyman Co, and Boise Cabinet Co in Idaho's Treasure Valley.";

/** Entities that describe the publisher and website on every public page. */
export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Organization", "HomeAndConstructionBusiness"],
      "@id": `${siteUrl}/#organization`,
      name: "P5 Home Co",
      legalName: SCHEMA_LEGAL_NAME,
      alternateName: "P5 Home Company",
      url: siteUrl,
      description: siteDescription,
      slogan: "One home. Five specialized teams.",
      foundingDate: "2020",
      telephone: SCHEMA_TELEPHONE,
      email: ESTIMATOR_BRAND.email,
      image: `${siteUrl}/images/p5-og.jpg`,
      logo: { "@type": "ImageObject", url: `${siteUrl}/android-chrome-512x512.png` },
      employee: {
        "@type": "Person",
        "@id": NICK_PERKINS_ID,
        name: PUBLIC_REPRESENTATIVE,
        jobTitle: "Public representative",
        worksFor: { "@id": `${siteUrl}/#organization` },
      },
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
      // Service-area business. HomeAndConstructionBusiness is the LocalBusiness
      // subtype. The street is the authorized public address; the cities below
      // stay areaServed and are not additional locations.
      address: {
        "@type": "PostalAddress",
        streetAddress,
        addressLocality,
        addressRegion,
        postalCode,
        addressCountry: "US",
      },
      areaServed: [
        { "@type": "AdministrativeArea", name: "Ada County, Idaho" },
        { "@type": "AdministrativeArea", name: "Canyon County, Idaho" },
        ...citiesServed.map((name) => ({
          "@type": "City",
          name,
        })),
      ],
      subOrganization: companies.map((company) => ({
        "@type": "Organization",
        "@id": `${company.url}/#organization`,
        name: company.name,
        url: company.url,
        description: company.description,
        image: `${siteUrl}${company.image}`,
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
