"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Arrow from "@/components/Arrow";
import { track } from "@/app/analytics";
import { ADU_CONSTRUCTION_URL, ADU_D3_LINE } from "@/app/publicIdentity";

type CompanyKey = "construction" | "remodeling" | "cabinetry" | "handyman" | "adu";

const quotePath: Record<CompanyKey, string> = {
  construction: "/quote/custom-home",
  remodeling: "/quote",
  cabinetry: "/quote/custom-cabinets",
  handyman: "/quote/handyman",
  adu: "/quote/adu",
};

const DETAILS: Record<
  CompanyKey,
  { name: string; reason: string; url: string; cta: string; label: string; accent: string }
> = {
  construction: {
    name: "Boise Construction Co",
    reason: "Design-build for new homes, land evaluation, plans, permitting, and construction from the ground up.",
    url: "https://boiseconstruction.co",
    cta: "Visit Boise Construction Co",
    label: "Build a new home",
    accent: "#c48d3f",
  },
  remodeling: {
    name: "Boise Remodeling Co",
    reason: "Accountable design-build for major renovations, additions, and projects that change how your home works.",
    url: "https://boiseremodeling.co",
    cta: "Visit Boise Remodeling Co",
    label: "Remodel my home",
    accent: "#7d9479",
  },
  cabinetry: {
    name: "Boise Cabinet Co",
    reason: "Made-to-order kitchens, vanities, built-ins, and coordinated storage throughout the home.",
    url: "https://boisecabinet.co",
    cta: "Visit Boise Cabinet Co",
    label: "Plan custom cabinets",
    accent: "#659b9a",
  },
  handyman: {
    name: "Boise Handyman Co",
    reason: "Finish work, installations, maintenance, and smaller projects that still deserve professional care.",
    url: "https://boisehandyman.co",
    cta: "Visit Boise Handyman Co",
    label: "Complete repairs",
    accent: "#c56b4a",
  },
  adu: {
    name: "Boise ADU Co",
    reason: ADU_D3_LINE,
    url: ADU_CONSTRUCTION_URL,
    cta: "Visit Boise Construction Co",
    label: "Add an ADU",
    accent: "#c97c99",
  },
};

/**
 * C14 interactive proof: company match with no email gate before a useful result.
 */
export default function CompanyFinder() {
  const [company, setCompany] = useState<CompanyKey | null>(null);
  const detail = company ? DETAILS[company] : null;

  useEffect(() => {
    if (company) track("company_finder_result", { company });
  }, [company]);

  return (
    <section className="company-finder" id="company-finder" aria-labelledby="company-finder-heading">
      <div className="content-shell company-finder-inner">
        <div className="company-finder-intro">
          <p className="eyebrow">Interactive match</p>
          <h2 id="company-finder-heading">Which company fits your project?</h2>
          <p>
            Pick the closest goal. You get a specialist recommendation right away, with no email required.
          </p>
        </div>

        {!company && (
          <div className="choice-cards company-finder-cards" role="list">
            {(Object.keys(DETAILS) as CompanyKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className="choice-card"
                style={{ ["--choice-accent" as string]: DETAILS[key].accent }}
                onClick={() => setCompany(key)}
              >
                <span className="choice-card-mark" aria-hidden="true" />
                <strong>{DETAILS[key].label}</strong>
              </button>
            ))}
          </div>
        )}

        {company && detail && (
          <div className="company-finder-result" style={{ ["--choice-accent" as string]: detail.accent }}>
            <p className="company-finder-kicker">Your P5 match</p>
            <h3>{detail.name}</h3>
            <p>{detail.reason}</p>
            <div className="company-finder-actions">
              <a
                className="button button-dark"
                href={detail.url}
                target={detail.url.startsWith("http") ? "_blank" : undefined}
                rel={detail.url.startsWith("http") ? "noreferrer" : undefined}
                onClick={() => track("company_click", { company, location: "company_finder" })}
              >
                {detail.cta} <Arrow diagonal={detail.url.startsWith("http")} />
              </a>
              <Link
                className="text-link"
                href={quotePath[company]}
                onClick={() => track("quote_click", { company, location: "company_finder" })}
              >
                Request a quote from P5 <Arrow />
              </Link>
            </div>
            <button type="button" className="company-finder-reset" onClick={() => setCompany(null)}>
              Try another project
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
