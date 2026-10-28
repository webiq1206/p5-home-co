"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import SiteChrome from "@/components/SiteChrome";
import SaveContactButton from "@/components/SaveContactButton";
import Arrow from "@/components/Arrow";

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
] as const;

export default function AboutClient({
  doplLookup,
  registration,
}: {
  doplLookup: string;
  registration: string;
}) {
  return (
    <main id="top" className="about-page">
      <SiteChrome>
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
            <div className="about-hero-actions" data-suppress-mobile-bar="">
              <Link className="button button-dark" href="/quote" data-cta="primary">
                Request a quote <Arrow />
              </Link>
              <a className="text-link" href="tel:+12084771169">
                Call (208) 477-1169
              </a>
            </div>
            <p className="about-trust-line">P5 Home Co LLC · Idaho Registered Contractor #{registration}</p>
          </div>
        </section>

        <figure className="about-family-photo content-shell">
          <img
            src="/images/about/perkins-family-meridian-idaho.webp"
            alt="Nick Perkins with his wife and five children at a pumpkin patch"
            width={2560}
            height={1920}
            fetchPriority="high"
            decoding="async"
          />
        </figure>

        <section className="about-section content-shell about-why-p5" aria-labelledby="why-p5">
          <h2 id="why-p5">Why it is called P5</h2>
          <p>
            The name stands for my five children and the Perkins family name. It is a daily reminder of why I work
            hard, the values I want to pass down, and the example I hope to set for them.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="background">
          <h2 id="background">Background</h2>
          <p>
            Construction has been part of my life for as long as I can remember. I grew up around the industry, and what
            started as something familiar became a career I have spent more than a decade building. I earned a
            bachelor&apos;s degree in Construction with an emphasis in Project Management at [university], [year], and
            went on to lead everything from small home renovations to multimillion-dollar custom homes and residential
            developments. I started P5 Home Co in Colorado in 2020 and moved the family and the company to the Treasure
            Valley in [year], where we live in Meridian.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="years-taught">
          <h2 id="years-taught">What those years taught me</h2>
          <p>
            Being a good contractor is not only about knowing how to build. It is about listening, communicating
            honestly, following through on commitments, and taking responsibility for the work you put your name on.
            When I started P5, I wanted a company that reflected those things. Not the biggest construction company in
            the valley, but the one people feel comfortable calling, trust to do the right thing, and are happy to
            recommend to their friends and family.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="why-matters">
          <h2 id="why-matters">Why it matters to me</h2>
          <p>
            As a father of five, I understand what a home means to a family. Whether we are fixing a door, remodeling a
            kitchen or building a house from the ground up, someone is trusting us with a place that means a great deal
            to them, and I never want to lose sight of that.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="who-you-meet">
          <h2 id="who-you-meet">Who you will work with</h2>
          <p>
            You meet me at the first visit. [Name, role] runs the schedule on remodels and builds, and the crew on
            repairs is ours, not day labour. Plumbing, electrical and HVAC go to licensed trade partners we schedule and
            stand behind. Every project has one written scope before any price, a weekly written update, and a
            workmanship warranty: one year on repairs and new builds (ten years structural where offered), two years on
            remodels and cabinet installation.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="the-company">
          <h2 id="the-company">The company</h2>
          <p>
            P5 Home Co LLC, Meridian, Idaho. Idaho Registered Contractor #{registration} (look it up at the{" "}
            <a href={doplLookup} target="_blank" rel="noopener noreferrer">
              Idaho DOPL
            </a>
            ). Insured; certificate on request. Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise
            Handyman Co are DBAs of P5 Home Co LLC; Boise ADU Co projects currently run through Boise Construction Co.
          </p>
        </section>

        <section className="about-section content-shell" aria-labelledby="four-companies">
          <h2 id="four-companies">The four companies</h2>
          <ul className="about-company-list">
            {COMPANIES.map((company) => (
              <li key={company.name}>
                <a href={company.href} target="_blank" rel="noreferrer">
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
                The P5 name represents my five kids, but the values behind it are what I hope they carry long after
                I&apos;m done building homes. Work hard. Keep your word. Treat people right. And always be proud to put
                your name on what you do.
              </p>
              <div className="about-closing-actions">
                <SaveContactButton location="about" />
                <Link className="button button-dark" href="/quote">
                  Request a quote <Arrow />
                </Link>
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
              />
              <figcaption>The Perkins family</figcaption>
            </figure>
          </div>
        </section>
      </SiteChrome>
    </main>
  );
}
