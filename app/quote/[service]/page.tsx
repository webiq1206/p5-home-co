import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { siteUrl } from "../../site";
import QuoteLanding from "../QuoteLanding";
import { serviceBySlug, serviceSlugs } from "../services";
import "../quote.css";

/**
 * One quote page per service, so an ad group's headline can match the search
 * that triggered it. /quote/thanks is a real sibling route and wins over this
 * dynamic segment, so it is never generated here.
 *
 * Every variant is prerendered and unknown slugs 404 rather than rendering a
 * thin page for any string someone types.
 */

export const dynamicParams = false;

export function generateStaticParams(): { service: string }[] {
  return serviceSlugs().map((service) => ({ service }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ service: string }>;
}): Promise<Metadata> {
  const { service: slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) return {};

  const path = `/quote/${service.slug}`;
  return {
    title: service.metaTitle,
    description: service.metaDescription,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "P5 Home Co",
      title: service.metaTitle,
      description: service.metaDescription,
      url: path,
      locale: "en_US",
      images: [
        {
          url: `${siteUrl}${service.image}`,
          alt: service.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: service.metaTitle,
      description: service.metaDescription,
      images: [`${siteUrl}${service.image}`],
    },
    /**
     * Paid-search landing variants. Each child company already owns the
     * indexable service page for this intent on its own domain (for example
     * boiseremodeling.co/services/kitchen-remodel), and two P5 pages competing
     * for "kitchen remodel Boise" would split that signal. These stay
     * crawlable and followed so the links out carry, but do not index. The
     * generic /quote page is the one indexable quote destination.
     */
    robots: { index: false, follow: true },
  };
}

export default async function ServiceQuotePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service: slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) notFound();
  return <QuoteLanding service={service} />;
}
