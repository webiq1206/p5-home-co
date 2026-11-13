/**
 * One estimator, six brands.
 *
 * A brand is a skin and a project list over the same engine. Colors are the
 * ones each site already uses (lib/familyBrand.ts in each repository). Adding
 * a brand is adding an entry here and choosing its projects; no pricing code
 * changes.
 *
 * Browser-safe: no server imports.
 */

import type { BrandId } from "./types.ts";

export type BrandConfig = {
  id: BrandId;
  /** Exact brand name in the lead pipeline (app/lib/leads/types.ts). */
  name:
    | "P5 Home Co"
    | "Boise Remodeling Co"
    | "Boise Construction Co"
    | "Boise Handyman Co"
    | "Boise Cabinet Co"
    | "Boise ADU Co";
  site: string;
  /** False keeps the estimator off the public site while the rest is ready. */
  live: boolean;
  accent: string;
  /** Darker accent that passes contrast as text on paper. */
  accentInk: string;
  phoneDisplay: string;
  phoneTel: string;
  heading: string;
  intro: string;
  /** Project ids from flows.ts, in the order shown. */
  projects: string[];
};

const PHONE = { phoneDisplay: "(208) 477-1169", phoneTel: "tel:+12084771169" };

export const BRAND_CONFIGS: Record<BrandId, BrandConfig> = {
  p5: {
    id: "p5",
    name: "P5 Home Co",
    site: "https://p5homeco.com",
    live: true,
    accent: "#ceb391",
    accentInk: "#705a45",
    ...PHONE,
    heading: "Get your instant estimate",
    intro: "Pick a project, make a few choices and see a preliminary price range.",
    projects: [
      "kitchen-remodel",
      "bathroom-remodel",
      "basement-finish",
      "whole-home",
      "flooring",
      "interior-paint",
      "kitchen-cabinets",
      "bathroom-vanity",
      "cabinet-refresh",
      "built-ins",
      "handyman",
      "custom-home",
      "addition",
      "garage-shop",
      "adu",
    ],
  },
  remodeling: {
    id: "remodeling",
    name: "Boise Remodeling Co",
    site: "https://boiseremodeling.co",
    live: true,
    accent: "#7d9479",
    accentInk: "#4d6249",
    ...PHONE,
    heading: "Get your instant remodel estimate",
    intro: "Pick a project, make a few choices and see a preliminary price range.",
    projects: ["kitchen-remodel", "bathroom-remodel", "basement-finish", "whole-home", "flooring", "interior-paint", "addition"],
  },
  construction: {
    id: "construction",
    name: "Boise Construction Co",
    site: "https://boiseconstruction.co",
    live: true,
    accent: "#c48d3f",
    accentInk: "#78531e",
    ...PHONE,
    heading: "Get an instant budget for your build",
    intro: "Pick what you are building, make a few choices and see a preliminary budget range.",
    projects: ["custom-home", "addition", "garage-shop", "adu"],
  },
  handyman: {
    id: "handyman",
    name: "Boise Handyman Co",
    site: "https://boisehandyman.co",
    live: true,
    accent: "#c56b4a",
    accentInk: "#92472c",
    ...PHONE,
    heading: "Get an instant estimate for your to-do list",
    intro: "Tap the jobs on your list and see a preliminary price range.",
    projects: ["handyman", "interior-paint", "flooring"],
  },
  cabinet: {
    id: "cabinet",
    name: "Boise Cabinet Co",
    site: "https://boisecabinet.co",
    live: true,
    accent: "#659b9a",
    accentInk: "#356463",
    ...PHONE,
    heading: "Get your instant cabinet estimate",
    intro: "Pick a project, make a few choices and see a preliminary price range.",
    projects: ["kitchen-cabinets", "bathroom-vanity", "cabinet-refresh", "built-ins"],
  },
  adu: {
    id: "adu",
    name: "Boise ADU Co",
    // The Boise ADU Co site does not exist yet. Its domain and brand colors
    // are owner decisions that have not been made, so the P5 parent values
    // stand in. The estimator is configured and tested, and stays unpublished
    // until the site is live and this is set to true.
    site: "",
    live: false,
    accent: "#ceb391",
    accentInk: "#705a45",
    ...PHONE,
    heading: "Get an instant budget for your ADU",
    intro: "Pick the kind of ADU, make a few choices and see a preliminary budget range.",
    projects: ["adu"],
  },
};

export function brandConfig(id: string | null | undefined): BrandConfig | null {
  return (BRAND_CONFIGS as Record<string, BrandConfig>)[String(id ?? "")] ?? null;
}

/** Origins allowed to frame the embed and call the public API. */
export function familyOrigins(): string[] {
  return Object.values(BRAND_CONFIGS).filter((b) => b.site).flatMap((b) => {
    const host = b.site.replace(/^https:\/\//, "");
    return [`https://${host}`, `https://www.${host}`];
  });
}
