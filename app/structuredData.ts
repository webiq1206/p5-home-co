import { citiesServed, companies, faqs, siteUrl } from "./site.ts";

export const siteTitle = "P5 Home Co | Five Specialized Home-Service Companies";
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
      alternateName: "P5 Home Company",
      url: siteUrl,
      description: siteDescription,
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
