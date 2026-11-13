import type { Metadata } from "next";

import GuidedEstimator from "@/components/estimator/GuidedEstimator";
import SiteChrome from "@/components/SiteChrome";
import { BRAND_CONFIGS } from "@/app/lib/estimator/brands";
import { estimatorImages } from "@/app/lib/estimator/images";

export const metadata: Metadata = {
  title: "Price your project | P5 Home Co",
  description: "Choose your project, make a few selections and see an itemized price for remodeling, cabinets, repairs and new construction in Boise and the Treasure Valley.",
  alternates: { canonical: "/estimator" },
};

export default async function EstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const project = typeof params.project === "string" ? params.project : null;
  const { id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects } = BRAND_CONFIGS.p5;
  return (
    <SiteChrome main>
      <GuidedEstimator brand={{ id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects }} images={estimatorImages()} initialProject={project} />
    </SiteChrome>
  );
}
