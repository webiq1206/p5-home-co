"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import SiteChrome from "@/components/SiteChrome";
import { FamilyButton } from "@/components/family/Button";
import SaveContactButton from "@/components/SaveContactButton";
import { AduLinkedText } from "@/components/AduLinkedText";
import { ADU_QUOTE_URL, leavesThisSite } from "../publicIdentity";

const COMPANIES = [
  {
    name: "Boise Construction Co",
    href: "https://boiseconstruction.co",
    line: "builds custom and semi-custom homes and ADUs on your lot or ours.",
  },
  {
    name: "Boise Remodeling Co",
    href: "https://boiseremodeling.co",
    line: "remodels kitchens, bathrooms and whole homes with design, permits and construction under one contract.",
  },
  {
    name: "Boise Cabinet Co",
    href: "https://boisecabinet.co",
    line: "designs custom cabinets to your measurements, built to order and installed by our crew.",
  },
  {
    name: "Boise Handyman Co",
    href: "https://boisehandyman.co",
    line: "handles repairs, installs and maintenance, including RE-10 inspection repair lists, with one written price before work starts.",
  },
  // Listed so the count matches the homepage and sitemap: four live sites plus Boise ADU Co, shown as coming.
  {
    name: "Boise ADU Co",
    href: ADU_QUOTE_URL,
    line: "ADUs are built by sister company Boise ADU Co, part of P5 Home Co.",
  },
] as const;

export default function AboutClient({
  doplLookup,
  registration,
}: {
  doplLookup: string;
  registration: string;
}) {
  return (
    <div id="top" className="about-page">
      <SiteChrome main>
        <section className="about-hero" aria-labelledby="about-heading">
          <div className="content-shell about-hero-inner">
            <nav className="about-breadcrumb" aria-label="Breadcrumb">
              <ol>
                <li>
                  <Link href="/">Home</Link>
                </li>
                <li aria-current="page">About</li>
              </ol>
            </nav>
            <p className="eyebrow">Real people. A higher standard.</p>
            <h1 id="about-heading">About P5 Home Co</h1>
            <p className="about-answer">
              P5 Home Co is the family company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and
              Boise Handyman Co. I&apos;m Nick Perkins, the founder. I&apos;m a husband, a dad to five kids, and someone
              who takes a lot of pride in the work that carries my name. Family is the biggest part of my life, and it
              is the reason P5 exists.
            </p>
            <div className="about-hero-actions">
              {/* data-hero-cta: the family bottom bar waits until this action has scrolled away. */}
              <FamilyButton href="/quote" size="lg" data-cta="primary" data-hero-cta="primary">
                Request a quote
              </FamilyButton>
              <a className="text-link" href="tel:+12084771169">
                Call (208) 477-1169
              </a>
            </div>
            <p className="about-trust-line">P5 Home Co LLC · Idaho Registered Contractor #{registration}</p>
          </div>
        </section>

        <figure className="about-family-photo content-shell">
          <img
            src="/images/about/perkins-family-meridian-idaho-1x1.webp"
            alt="Nick Perkins with his wife and five children at a pumpkin patch in Meridian, Idaho"
            width={2048}
            height={2048}
            fetchPriority="high"
            decoding="async"
          />
        </figure>

        <section className="about-section content-shell about-family-drive" aria-labelledby="family-drive">
          <h2 id="family-drive">What drives the work</h2>
          <p>
            Family is a daily reminder of why I work hard, the values I want to pass down, and the example I hope to
            set for my kids.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="background">
          <h2 id="background">Background</h2>
          <ul>
            <li>Construction has been part of my life for as long as I can remember.</li>
            <li>
              I grew up around the industry, and what started as something familiar became a career I have spent more
              than a decade building.
            </li>
            <li>
              I earned a bachelor&apos;s degree in Construction with an emphasis in Project Management, and went on to
              lead everything from small home renovations to multimillion-dollar custom homes and residential
              developments.
            </li>
            <li>
              I started P5 Home Co in Colorado in 2020 and moved the family and the company to the Treasure Valley in
              2025, where we live in Meridian.
            </li>
          </ul>
        </section>

        <section className="about-section content-shell" aria-labelledby="years-taught">
          <h2 id="years-taught">What those years taught me</h2>
          <ul>
            <li>Being a good contractor is not only about knowing how to build.</li>
            <li>
              It is about listening, communicating honestly, following through on commitments, and taking responsibility
              for the work you put your name on.
            </li>
            <li>When I started P5, I wanted a company that reflected those things.</li>
            <li>
              Not the biggest construction company in the valley, but the one people feel comfortable calling, trust to
              do the right thing, and are happy to recommend to their friends and family.
            </li>
          </ul>
        </section>

        <section className="about-section content-shell" aria-labelledby="why-matters">
          <h2 id="why-matters">Why it matters to me</h2>
          <ul>
            <li>As a father of five, I understand what a home means to a family.</li>
            <li>
              Whether we are fixing a door, remodeling a kitchen or building a house from the ground up, someone is
              trusting us with a place that means a great deal to them, and I never want to lose sight of that.
            </li>
          </ul>
        </section>

        <section className="about-section content-shell" aria-labelledby="who-you-meet">
          <h2 id="who-you-meet">Who you will work with</h2>
          <ul>
            <li>You meet me at the first visit.</li>
            <li>
              On remodels and builds, our project team runs the schedule, and the crew on repairs is ours, not day
              labour.
            </li>
            <li>Plumbing, electrical and HVAC go to licensed trade partners we schedule and stand behind.</li>
            <li>
              Every project has one written scope before any price, a weekly written update, and a workmanship warranty:
              one year on repairs and new builds (ten years structural where offered), two years on remodels and cabinet
              installation.
            </li>
          </ul>
        </section>

        <section className="about-section content-shell" aria-labelledby="the-company">
          <h2 id="the-company">The company</h2>
          <ul>
            <li>P5 Home Co LLC, Meridian, Idaho.{" "}<a href={doplLookup} target="_blank" rel="noopener noreferrer">Idaho Registered Contractor #{registration}</a>. Insured; certificate on request.</li>
            <li><AduLinkedText text="Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co are DBAs of P5 Home Co LLC. ADUs are built by sister company Boise ADU Co, part of P5 Home Co."></AduLinkedText></li>
          </ul>
        </section>

        <section className="about-section content-shell" aria-labelledby="five-companies">
          <h2 id="five-companies">The five companies</h2>
          <ul className="about-company-list">
            {COMPANIES.map((company) => (
              <li key={company.name}>
                <a href={company.href} {...(leavesThisSite(company.href) ? { target: "_blank", rel: "noopener" } : undefined)}>
                  {company.name}
                </a>{" "}
                {company.line}
              </li>
            ))}
          </ul>
        </section>

        <section className="about-closing content-shell" aria-labelledby="closing">
          <div className="about-closing-grid">
            <div>
              <h2 id="closing">Closing</h2>
              <p>
                The values behind this company are what I hope my kids carry long after I&apos;m done building homes.
                Work hard. Keep your word. Treat people right. And always be proud to put your name on what you do.
              </p>
              <div className="about-closing-actions">
                <SaveContactButton location="about" />
                <FamilyButton href="/quote" size="lg">
                  Request a quote
                </FamilyButton>
              </div>
            </div>
            <figure className="about-beach">
              <img
                src="/images/about/perkins-family-portrait.webp"
                alt="The Perkins family, Nick, his wife and their five children, on a beach"
                width={1365}
                height={1365}
                loading="lazy"
                decoding="async"
                className="about-people-photo"
              />
              <figcaption>The Perkins family</figcaption>
            </figure>
          </div>
        </section>
      </SiteChrome>
    </div>
  );
}
