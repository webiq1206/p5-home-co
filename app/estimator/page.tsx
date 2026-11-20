import type { Metadata } from "next";

import GuidedEstimator from "@/components/estimator/GuidedEstimator";
import SiteChrome from "@/components/SiteChrome";
import { BRAND_CONFIGS } from "@/app/lib/estimator/brands";
import { estimatorEntry } from "@/app/lib/estimator/flows";
import { estimatorImages } from "@/app/lib/estimator/images";

export const metadata: Metadata = {
  title: { absolute: "Instant estimate for your home project | P5 Home Co" },
  description: "Instant estimate for your Treasure Valley home project. Answer a few questions and see a free preliminary price range on screen. No appointment needed.",
  alternates: { canonical: "/estimator" },
};

export default async function EstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects } = BRAND_CONFIGS.p5;
  const entry = estimatorEntry(projects, { project: typeof params.project === "string" ? params.project : null, trade: typeof params.trade === "string" ? params.trade : null });
  return (
    <SiteChrome main>
      {/*
        The page's H1 and one plain sentence, in the server HTML for crawlers and
        screen readers (SEO audit P5-T4). Visually hidden: each question screen is
        sized to the viewport, and its own H2 is the visible heading. The embed
        (/estimator/embed) is unchanged.
      */}
      <div className="visually-hidden">
        <h1>Get an instant estimate for your home project</h1>
        <p>Answer a few questions and see a preliminary price range on screen. It is free and needs no appointment.</p>
      </div>
      <GuidedEstimator brand={{ id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects }} images={estimatorImages()} initialProject={entry.project} initialTrade={entry.trade} />
    </SiteChrome>
  );
}
