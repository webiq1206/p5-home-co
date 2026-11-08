import { officeOpeningHours } from "../lib/businessHours.ts";
import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";
import {
  NICK_PERKINS_ID,
  PUBLIC_REPRESENTATIVE,
  SCHEMA_LEGAL_NAME,
  SCHEMA_TELEPHONE,
  CONTRACTOR_REGISTRATION,
  P5_GOOGLE_BUSINESS_PROFILE_URL,
} from "./publicIdentity.ts";
import { SHOW_FOUNDING_YEAR } from "./publicClaims.ts";
import { citiesServed, companies, faqs, siteUrl } from "./site.ts";

/** Stable id for this business. Child sites reference it as parentOrganization. */
export const businessId = `${siteUrl}/#business`;

// Confirmed public profiles for P5 Home Co LLC.
// The full sameAs list is coming in a later ticket.
export const P5_SAME_AS = [
  "https://www.facebook.com/p5homeco",
  "https://nextdoor.com/pages/boise-remodeling-co-meridian-id/",
  "https://ezlocal.com/id/meridian/home-remodeling/0919899218",
  "https://www.cylex.us.com/company/p5-home-co--llc-40749871.html",
  "https://www.google.com/maps?cid=11869148461693849141",
  P5_GOOGLE_BUSINESS_PROFILE_URL,
] as const;

/** Brand profiles only. P5's Nextdoor page is not repeated on Boise Remodeling. */
const BRAND_SAME_AS: Record<string, readonly string[]> = {};

const BRAND_ORIGINS = [
  ["Boise Construction Co", "https://boiseconstruction.co"],
  ["Boise Remodeling Co", "https://boiseremodeling.co"],
  ["Boise Cabinet Co", "https://boisecabinet.co"],
  ["Boise Handyman Co", "https://boisehandyman.co"],
] as const;

function brandSubOrganizations() {
  const brands = BRAND_ORIGINS.map(([name, origin]) => {
    const company = companies.find((entry) => entry.name === name);
    if (!company) throw new Error(`Missing company card for ${name}`);
    const sameAs = BRAND_SAME_AS[name];
    return {
      "@type": "Organization" as const,
      "@id": `${origin}/#business`,
      name,
      url: origin,
      description: company.description,
      image: `${siteUrl}${company.image}`,
      ...(sameAs ? { sameAs } : {}),
      parentOrganization: { "@id": businessId },
    };
  });
  // boiseadu.co has no DNS record. Boise ADU Co links to /quote/adu.
  return [
    ...brands,
    {
      "@type": "Organization" as const,
      "@id": `${siteUrl}/#adu`,
      name: "Boise ADU Co",
      url: `${siteUrl}/quote/adu`,
      parentOrganization: { "@id": businessId },
    },
  ];
}

export const siteTitle = "Boise Builders, Remodelers, Cabinets & Repairs | P5 Home Co";
export const siteDescription =
  "Parent company of Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co in Idaho's Treasure Valley.";

/** Schema-only. Visible titles, meta descriptions, and page copy keep siteDescription. */
export const businessDescription =
  "Parent company of Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, Boise Handyman Co and Boise ADU Co, five home teams serving Idaho's Treasure Valley.";

/** Entities that describe the publisher and website on every public page. */
export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["HomeAndConstructionBusiness", "GeneralContractor"],
      "@id": businessId,
      name: "P5 Home Co",
      legalName: SCHEMA_LEGAL_NAME,
      alternateName: "P5 Home Company",
      url: siteUrl,
      description: businessDescription,
      slogan: "One home. Five specialized teams.",
      ...(SHOW_FOUNDING_YEAR ? { foundingDate: "2020" } : {}),
      telephone: SCHEMA_TELEPHONE,
      email: ESTIMATOR_BRAND.email,
      image: `${siteUrl}/images/p5-og.jpg`,
      logo: { "@type": "ImageObject", url: `${siteUrl}/android-chrome-512x512.png` },
      sameAs: P5_SAME_AS,
      employee: {
        "@type": "Person",
        "@id": NICK_PERKINS_ID,
        name: PUBLIC_REPRESENTATIVE,
        jobTitle: "Founder",
        worksFor: { "@id": businessId },
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
      // streetAddress pending owner approval
      address: {
        "@type": "PostalAddress",
        addressLocality: "Meridian",
        addressRegion: "ID",
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
      // Four live brand sites, plus Boise ADU Co. ADU links to /quote/adu.
      subOrganization: brandSubOrganizations(),
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
      publisher: { "@id": businessId },
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
  about: { "@id": businessId },
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
