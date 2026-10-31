"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import Reveal from "@/components/Reveal";
import { useEffect, useRef, useState } from "react";
import {
  SHOW_UNPROVEN_SELF_PERFORM,
  CRAFT_EXPERTISE,
  SHOW_FAKE_STAFF_IMAGES,
  cabinetProof,
  constructionImage,
  handymanImage,
} from "./publicClaims";
import { citiesServed, faqs, HOW_P5_WORKS, HOW_P5_WORKS_TITLE } from "./site";
import { track } from "./analytics";
import { homePageSchema, serializeJsonLd } from "./structuredData";
import Arrow from "@/components/Arrow";
import SiteChrome from "@/components/SiteChrome";
import CompanyFinder from "@/components/CompanyFinder";
import {
  imageVariantFor,
  FRAMING_FOOTHILLS,
  FEATURED_BOISE_EXTERIOR,
  FEATURED_BOISE_GREAT_ROOM,
  FEATURED_BOISE_KITCHEN,
  FEATURED_BOISE_BATHROOM,
  REMODEL_KITCHEN_LIVING,
  BACKYARD_ADU,
  TREASURE_VALLEY_FOOTHILLS,
  CRAFT_TRIM_DETAIL,
} from "./imageVariants.ts";
import {
  ADU_CONSTRUCTION_URL,
  ADU_D3_LINE,
  PUBLIC_REGISTRATION,
} from "./publicIdentity";

type CompanyKey = "construction" | "remodeling" | "cabinetry" | "handyman" | "adu";

/** The quote page that matches each company, so the matcher can end in a request, not only a link out. */
const quotePath: Record<CompanyKey, string> = {
  construction: "/quote/custom-home",
  remodeling: "/quote",
  cabinetry: "/quote/custom-cabinets",
  handyman: "/quote/handyman",
  adu: "/quote/adu",
};

const companyDetails: Record<
  CompanyKey,
  { name: string; reason: string; url: string; cta: string; label: string; options: string[] }
> = {
  construction: {
    name: "Boise Construction Co",
    reason: "The design-build team for new homes, land evaluation, plans, permitting, and construction from the ground up.",
    url: "https://boiseconstruction.co",
    cta: "Visit Boise Construction Co",
    label: "Build a new home",
    options: ["Custom home", "Semi-custom home", "Build on land I own", "Home plans or lot evaluation"],
  },
  remodeling: {
    name: "Boise Remodeling Co",
    reason: "The accountable design-build team for major renovations, additions, and projects that change how your existing home works.",
    url: "https://boiseremodeling.co",
    cta: "Visit Boise Remodeling Co",
    label: "Remodel my home",
    options: ["Kitchen remodel", "Bathroom remodel", "Whole-home remodel", "Addition or basement"],
  },
  cabinetry: {
    name: "Boise Cabinet Co",
    reason: "The cabinetry specialists for made-to-order kitchens, vanities, built-ins, and coordinated storage throughout the home.",
    url: "https://boisecabinet.co",
    cta: "Visit Boise Cabinet Co",
    label: "Plan custom cabinets",
    options: ["Kitchen cabinets", "Bathroom vanity", "Built-ins or storage", "Whole-home cabinetry"],
  },
  handyman: {
    name: "Boise Handyman Co",
    reason: "The skilled home-repair team for finish work, installations, maintenance, and the smaller projects that still deserve professional care.",
    url: "https://boisehandyman.co",
    cta: "Visit Boise Handyman Co",
    label: "Complete repairs",
    options: ["Drywall or trim repair", "Mounting or installation", "Deck or exterior repair", "A multi-item home list"],
  },
  adu: {
    name: "Boise ADU Co",
    reason: ADU_D3_LINE,
    url: ADU_CONSTRUCTION_URL,
    cta: "Visit Boise Construction Co",
    label: "Add an ADU",
    options: ["Detached ADU", "Garage conversion", "Basement or interior unit", "Feasibility and permits"],
  },
};

export default function Home() {
  const [matcherOpen, setMatcherOpen] = useState(false);
  const openMatcher = () => {
    setMatcherOpen(true);
    track("matcher_open");
  };

  return (
    <main id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homePageSchema) }}
      />
      <SiteChrome onOpenMatcher={openMatcher} imageHero>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-media">
            <img
              className="hero-image"
              src={FEATURED_BOISE_EXTERIOR.src}
              alt={FEATURED_BOISE_EXTERIOR.alt}
              width={FEATURED_BOISE_EXTERIOR.width}
              height={FEATURED_BOISE_EXTERIOR.height}
              srcSet={FEATURED_BOISE_EXTERIOR.srcSet}
              sizes="100vw"
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <div className="hero-panel">
            <div className="hero-content content-shell">
              <div className="hero-copy">
                <h1 id="hero-heading">Boise’s Home <span>Specialists</span></h1>
                <p className="hero-lede">New homes, remodeling, cabinets, repairs and ADUs.</p>
                <div className="hero-actions" data-suppress-mobile-bar="">
                  <Link className="button button-light"
                    href="/quote"
                    data-cta="primary"
                    onClick={() => track("quote_click", { location: "hero" })}
                  >
                    Request a quote
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/*
          Stat row (C14). Every figure is already published on this site and is the
          owner's own statement; none is new:
          - 5: the five companies in the stack below ("One standard across five companies").
          - citiesServed.length (9): the cities listed in the service-area section and the /quote footer.
          - 1 business day: the reply promise on the request form, the chat and /estimate.
          Add a figure here only with the same kind of source. Project counts, years and
          ratings stay out until the owner documents them (see app/publicClaims.ts).
        */}
        <section className="stat-row" aria-label="P5 Home Co at a glance">
          <div className="content-shell stat-grid">
            <p>
              <strong>5</strong>
              <span>companies</span>
            </p>
            <p>
              <strong>{citiesServed.length}</strong>
              <span>cities served</span>
            </p>
            <p>
              <strong>1</strong>
              <span>business day to reply</span>
            </p>
          </div>
        </section>

        <section className="trust-strip" aria-label="P5 Home Co credentials">
          <div className="content-shell trust-grid trust-grid-compact">
            <div>
              <strong>{PUBLIC_REGISTRATION}</strong>
              <span>Look it up at Idaho DOPL</span>
            </div>
            <div>
              <strong>Bonded and insured</strong>
              <span>Certificate on request</span>
            </div>
            <div>
              <strong>Written scope first</strong>
              <span>Price after the scope is clear</span>
            </div>
            <div>
              <strong>Ada and Canyon</strong>
              <span>Treasure Valley service area</span>
            </div>
          </div>
        </section>

        <CompanyFinder />

        <section id="companies" className="companies section-pad">
          <Reveal className="content-shell">
            <div className="companies-heading">
              <div>
                <p className="eyebrow eyebrow-light">The P5 family</p>
                <h2>
                  The right company
                  <br />
                  for your project.
                </h2>
              </div>
              <p>Specialist teams, each focused on its own kind of work. Choose the project you have in mind.</p>
            </div>
            <nav className="company-index" aria-label="Choose the company for your project">
              <Link href="/#construction">
                <span>01</span>
                <strong>New home construction</strong>
                <small>Boise Construction Co</small>
              </Link>
              <Link href="/#remodeling">
                <span>02</span>
                <strong>Remodeling &amp; renovations</strong>
                <small>Boise Remodeling Co</small>
              </Link>
              <Link href="/#cabinetry">
                <span>03</span>
                <strong>Cabinets &amp; built-ins</strong>
                <small>Boise Cabinet Co</small>
              </Link>
              <Link href="/#handyman">
                <span>04</span>
                <strong>Home repairs &amp; RE-10</strong>
                <small>Boise Handyman Co</small>
              </Link>
              <Link href="/#adu">
                <span>05</span>
                <strong>Accessory dwelling units</strong>
                <small>Boise ADU Co · Through Construction</small>
              </Link>
            </nav>
          </Reveal>
        </section>

        <section id="kitchen-example" className="kitchen-example section-pad" aria-labelledby="kitchen-example-heading">
          <Reveal className="content-shell kitchen-example-inner">
            <p className="eyebrow">A worked example</p>
            <h2 id="kitchen-example-heading">A complete kitchen, three specialists.</h2>
            <ol className="kitchen-example-steps">
              <li>
                <span>01</span>
                <div>
                  <strong>Boise Remodeling Co</strong>
                  <p>Layout, permits, demolition and construction.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Boise Cabinet Co</strong>
                  <p>Cabinet design and installation.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Boise Handyman Co</strong>
                  <p>Final mounting and punch list.</p>
                </div>
              </li>
            </ol>
            <p className="kitchen-example-close">One contract, one project manager, one invoice.</p>
          </Reveal>
        </section>

        <BrandPanel
          id="construction"
          number="01"
          category="New home building"
          logo="/brands/boise-construction-co.svg"
          image={constructionImage}
          alt={
            SHOW_FAKE_STAFF_IMAGES
              ? "Wood-framed house under construction with exposed roof trusses and a Boise Construction Co logo"
              : FRAMING_FOOTHILLS.alt
          }
          headline={
            <>
              From bare lot
              <br />
              to the keys.
            </>
          }
          className="brand-construction"
          description="Custom and semi-custom homes planned around your lot, budget, and the way you want to live. Design, engineering, permitting, and construction stay with one accountable team."
          services={["Custom home building", "Semi-custom homes", "Build on your lot", "Home design and plans"]}
          proof="Line-item budget before construction"
          url="https://boiseconstruction.co"
          linkLabel="Explore Boise Construction Co"
        />
        <BrandPanel
          id="remodeling"
          number="02"
          category="Design-build remodeling"
          logo="/brands/boise-remodeling-co-dark.svg"
          image={REMODEL_KITCHEN_LIVING.src}
          alt={REMODEL_KITCHEN_LIVING.alt}
          headline={
            <>
              Reimagine the
              <br />
              home you love.
            </>
          }
          reverse
          className="brand-remodeling"
          description="Major renovations managed under one roof, with design direction, a written scope, permits, and construction coordinated by a dedicated project team."
          services={["Kitchen remodeling", "Bathroom remodeling", "Whole-home remodeling", "Additions"]}
          proof="Written progress update every Friday"
          url="https://boiseremodeling.co"
          linkLabel="Explore Boise Remodeling Co"
        />
        <BrandPanel
          id="cabinetry"
          number="03"
          category="Custom cabinetry"
          logo="/brands/boise-cabinet-co-dark.svg"
          image="/images/p5-cabinet.webp"
          alt="Light wood kitchen cabinets with slim brass bar pulls, a white countertop, and a marble backsplash"
          headline={
            <>
              Made to fit.
              <br />
              Built to order.
            </>
          }
          className="brand-cabinetry"
          description="Custom cabinets designed to your measurements, built to order, and installed by our Treasure Valley crew, from the first layout and finish selection through the final walkthrough."
          services={["Kitchen cabinetry", "Bathroom vanities", "Built-ins and storage", "Whole-home cabinetry"]}
          proof={cabinetProof || "Built to order · Installed by our crew"}
          url="https://boisecabinet.co"
          linkLabel="Explore Boise Cabinet Co"
        />
        <BrandPanel
          id="handyman"
          number="04"
          category="Home repair and maintenance"
          logo="/brands/boise-handyman-co.svg"
          image={SHOW_FAKE_STAFF_IMAGES ? handymanImage : CRAFT_TRIM_DETAIL.src}
          alt={
            SHOW_FAKE_STAFF_IMAGES
              ? "White baseboard and door casing being installed, with a Boise Handyman Co logo"
              : CRAFT_TRIM_DETAIL.alt
          }
          headline={
            <>
              Your list.
              <br />
              Handled right.
            </>
          }
          reverse
          className="brand-handyman"
          description="Dependable skilled help for repairs, installations, and finishing projects. The same care and accountability, sized for the work that keeps your home working well."
          services={["Drywall and trim repair", "TV and fixture mounting", "Deck and exterior repair", "Home maintenance and RE-10 repairs"]}
          proof="One list · One skilled local team"
          url="https://boisehandyman.co"
          linkLabel="Explore Boise Handyman Co"
        />
        <BrandPanel
          id="adu"
          number="05"
          category="Accessory dwelling units"
          logo="/brands/boise-adu-co-dark.svg"
          image={BACKYARD_ADU.src}
          alt={BACKYARD_ADU.alt}
          headline={
            <>
              More home.
              <br />
              Same lot.
            </>
          }
          className="brand-adu"
          description={ADU_D3_LINE}
          services={["Detached ADU", "Garage conversion", "Basement or interior unit", "Feasibility and permits"]}
          proof="Projects run through Boise Construction Co"
          url={ADU_CONSTRUCTION_URL}
          linkLabel="Go to Boise Construction Co"
          comingSoon
        />

        <section
          id="request-form"
          className="request-entry"
          aria-labelledby="request-entry-heading"
          data-suppress-mobile-bar=""
        >
          <div className="content-shell">
            <div className="request-entry-card">
              <div className="request-entry-copy">
                <p className="eyebrow">Send a request</p>
                <h2 id="request-entry-heading">Start your request</h2>
                <p>
                  Tell us what you are planning and attach plans or photos if you have them. The right team replies
                  within one business day.
                </p>
              </div>
              <div className="request-entry-actions">
                <Link
                  className="button button-dark"
                  href="/quote"
                  data-cta="primary"
                  onClick={() => track("quote_click", { location: "request_entry" })}
                >
                  Request a quote <Arrow />
                </Link>
                <p>Call, chat, or text from the header if you would rather talk.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="how-p5" aria-labelledby="how-p5-heading">
          <div className="content-shell">
            <div className="how-p5-layout">
              <div className="how-p5-intro">
                <p className="eyebrow">A clear place to start</p>
                <h2 id="how-p5-heading">{HOW_P5_WORKS_TITLE}</h2>
                <p>
                  Start with your project.
                  <br />
                  We will help you find the right team.
                </p>
                <Link
                  className="button button-dark"
                  href="/quote"
                  onClick={() => track("quote_click", { location: "how_p5" })}
                >
                  Request a quote
                </Link>
              </div>
              <ol className="how-p5-steps">
                {HOW_P5_WORKS.map((step, index) => (
                  <li key={step.title}>
                    <span className="how-p5-number" aria-hidden="true">
                      0{index + 1}
                    </span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="featured-project" className="featured-project section-pad" aria-labelledby="featured-project-heading">
          <Reveal className="content-shell featured-project-intro">
            <div>
              <p className="eyebrow">Ideas for your home</p>
              <h2 id="featured-project-heading">
                Spaces for everyday living.
              </h2>
            </div>
            <p>
              Explore layouts, materials and details for your next project, from kitchens and living spaces to
              bathrooms. Your plans start with your home and how you want to use it.
            </p>
          </Reveal>
          <div className="content-shell featured-project-grid featured-project-grid-3" role="list">
            <div className="featured-project-shot" role="listitem">
              <img
                src={FEATURED_BOISE_GREAT_ROOM.src}
                alt={FEATURED_BOISE_GREAT_ROOM.alt}
                width={FEATURED_BOISE_GREAT_ROOM.width}
                height={FEATURED_BOISE_GREAT_ROOM.height}
                loading="lazy"
                decoding="async"
              />
              <span>Great room · Representative design</span>
            </div>
            <div className="featured-project-shot" role="listitem">
              <img
                src={FEATURED_BOISE_KITCHEN.src}
                alt={FEATURED_BOISE_KITCHEN.alt}
                width={FEATURED_BOISE_KITCHEN.width}
                height={FEATURED_BOISE_KITCHEN.height}
                loading="lazy"
                decoding="async"
              />
              <span>Kitchen · Representative design</span>
            </div>
            <div className="featured-project-shot" role="listitem">
              <img
                src={FEATURED_BOISE_BATHROOM.src}
                alt={FEATURED_BOISE_BATHROOM.alt}
                width={FEATURED_BOISE_BATHROOM.width}
                height={FEATURED_BOISE_BATHROOM.height}
                loading="lazy"
                decoding="async"
              />
              <span>Primary bath · Representative design</span>
            </div>
          </div>
        </section>

        <section id="p5-standard" className="standard section-pad">
          <Reveal className="content-shell">
            <div className="standard-heading">
              <div>
                <p className="eyebrow eyebrow-light">What P5 adds</p>
                <h2>One standard across five companies</h2>
              </div>
              <p>
                Specialization should create confidence, not more coordination. These are the operating expectations
                that connect every P5 company.
              </p>
            </div>
            <div className="standard-grid">
              <Standard number="01" title="Clarity before commitment">
                Share your plans or choose “Just contact me” in the{" "}
                <Link href="/quote" style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>
                  request form
                </Link>
                . Review the scope with the right specialist. Agree on the work, price and schedule before work begins.
              </Standard>
              <Standard number="02" title="One accountable team">
                You know who owns the next step, who to contact, and where the project stands.
              </Standard>
              <Standard number="03" title="Proactive communication">
                Decisions, schedule changes, and budget impacts are raised early and documented clearly.
              </Standard>
              <Standard number="04" title="The right company for the work">
                Start with your project type. Your P5 specialist reviews the scope and explains who to contact and what
                happens next.
              </Standard>
            </div>
            <div className="process-proof">
              <span>Built into the process</span>
              <ul>
                <li>Written scopes</li>
                <li>Permits handled in-house where required</li>
                <li>Dedicated project ownership</li>
                <li>Workmanship support</li>
              </ul>
            </div>
          </Reveal>
        </section>

        <section id="who-you-hire" className="who-hire section-pad" aria-labelledby="who-hire-heading">
          <Reveal className="content-shell who-hire-grid">
            <img
              className="who-hire-photo"
              src="/images/about/perkins-family-meridian-idaho-1x1.webp"
              alt="Nick Perkins with his wife and five children at a pumpkin patch in Meridian, Idaho"
              width={2048}
              height={2048}
              loading="lazy"
              decoding="async"
            />
            <div>
              <p className="eyebrow">Who you are hiring</p>
              <h2 id="who-hire-heading">Nick Perkins, founder</h2>
              <p>
                Construction project manager, bachelor&apos;s degree in Construction with an emphasis in Project
                Management, more than a decade of custom homes, remodels and developments. Husband, father of five,
                Meridian.
              </p>
              <p className="who-hire-quote">Work hard. Keep your word. Treat people right.</p>
              <Link className="text-link" href="/about">
                Read Nick&apos;s story <Arrow />
              </Link>
            </div>
          </Reveal>
        </section>

        <section id="service-area" className="service-area section-pad">
          <Reveal className="content-shell service-area-grid">
            <div>
              <p className="eyebrow">Our home is the Treasure Valley</p>
              <h2>
                Local teams.
                <br />
                Valley-wide reach.
              </h2>
              <p className="service-area-copy">
                P5 companies serve homeowners across Ada and Canyon counties, with practical knowledge of local homes,
                permitting offices, building conditions, and communities.
              </p>
              <button className="text-link" type="button" onClick={openMatcher}>
                Choose your company <Arrow />
              </button>
            </div>
            <div className="service-area-visual">
              <img
                src={TREASURE_VALLEY_FOOTHILLS.src}
                alt={TREASURE_VALLEY_FOOTHILLS.alt}
                width={TREASURE_VALLEY_FOOTHILLS.width}
                height={TREASURE_VALLEY_FOOTHILLS.height}
                loading="lazy"
                decoding="async"
              />
              <div className="area-list" aria-label="Cities served">
                {citiesServed.map((city) => (
                  <span key={city}>{city}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        <section id="faq" className="faq section-pad" aria-labelledby="faq-heading">
          <Reveal className="content-shell faq-layout">
            <div>
              <p className="eyebrow">Common questions</p>
              <h2 id="faq-heading">
                Answers before
                <br />
                you commit.
              </h2>
              <p className="faq-intro">
                If your question is not here, use the company cards below or send a short request and we will point you
                to the right team.
              </p>
            </div>
            <div className="faq-list">
              {faqs.map((item) => (
                <details className="faq-item" key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="final-cta">
          <Reveal className="content-shell final-cta-content">
            <p className="eyebrow eyebrow-light">Start with the need, not the company</p>
            <h2>Tell us what you are planning. We will point you to the right team.</h2>
            <div className="final-cta-actions" data-suppress-mobile-bar="">
              <Link
                className="button button-dark"
                href="/quote"
                data-cta="primary"
                onClick={() => track("quote_click", { location: "final_cta" })}
              >
                Request a quote <Arrow />
              </Link>
              <button className="text-link text-link-light" type="button" onClick={openMatcher}>
                Help me choose a company <Arrow />
              </button>
            </div>
          </Reveal>
        </section>
      </SiteChrome>
      {matcherOpen && <ProjectMatcher onClose={() => setMatcherOpen(false)} />}
    </main>
  );
}

function BrandPanel({
  id,
  number,
  category,
  logo,
  wordmark,
  image,
  alt,
  headline,
  className,
  reverse = false,
  description,
  services,
  proof,
  url,
  linkLabel,
  comingSoon = false,
}: {
  id: string;
  number: string;
  category: string;
  logo?: string;
  wordmark?: string;
  image: string;
  alt: string;
  headline: React.ReactNode;
  className: string;
  reverse?: boolean;
  description: string;
  services: string[];
  proof: string;
  url: string;
  linkLabel: string;
  comingSoon?: boolean;
}) {
  const external = url.startsWith("http");
  const served = imageVariantFor(image);
  return (
    <section id={id} className={`brand-panel ${reverse ? "brand-panel-reverse" : ""} ${className}`}>
      <div className="brand-image-wrap">
        <img
          src={image}
          alt={alt}
          loading="lazy"
          decoding="async"
          {...(served ? { srcSet: served.srcSet, sizes: served.sizes, width: served.width, height: served.height } : {})}
        />
      </div>
      <Reveal className="brand-content">
        <div className="brand-topline">
          <span>{number}</span>
          <span>{category}</span>
        </div>
        {logo ? (
          <img className="brand-logo" src={logo} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        ) : (
          <div className="text-wordmark">
            <span>Boise</span>
            <strong>
              {wordmark} <b>Co</b>
            </strong>
          </div>
        )}
        <h3>{headline}</h3>
        <p>{description}</p>
        <ul className="service-list">
          {services.map((service) => (
            <li key={service}>{service}</li>
          ))}
        </ul>
        {proof ? (
          <div className="brand-proof">
            <span aria-hidden="true">✓</span>
            {proof}
          </div>
        ) : null}
        <a
          className="brand-link"
          href={url}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener" : undefined}
          onClick={() =>
            track(external ? "company_click" : url.startsWith("tel:") ? "phone_click" : "quote_click", {
              company: id,
              location: "panel",
            })
          }
        >
          {linkLabel} <Arrow diagonal={external} />
        </a>
        {comingSoon && <span className="launch-note">Standalone website coming</span>}
      </Reveal>
    </section>
  );
}

function Standard({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article>
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function ProjectMatcher({ onClose }: { onClose: () => void }) {
  const [company, setCompany] = useState<CompanyKey | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusable();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);
  const detail = company ? companyDetails[company] : null;
  const step = project ? 3 : company ? 2 : 1;

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("#matcher-title")?.focus();
  }, [step]);

  useEffect(() => {
    if (company && project) track("matcher_result", { company, project });
  }, [company, project]);

  return (
    <div className="matcher" role="dialog" aria-modal="true" aria-labelledby="matcher-title">
      <button className="matcher-backdrop" type="button" tabIndex={-1} aria-label="Close company matcher" onClick={onClose} />
      <div className="matcher-panel" ref={panelRef}>
        <div className="matcher-header">
          <Link className="wordmark" href="/" aria-label="P5 Home Co">
            <img className="p5-header-logo" src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co, The Home Company" />
          </Link>
          <div className="matcher-progress">
            <span>0{step}</span>
            <i>
              <b style={{ width: `${step * 33.333}%` }} />
            </i>
            <span>03</span>
          </div>
          <button className="matcher-close" type="button" onClick={onClose} aria-label="Close company matcher">
            ×
          </button>
        </div>
        <div className="matcher-body">
          {!company && (
            <>
              <p className="eyebrow">Step 1 · Your goal</p>
              <h2 id="matcher-title" tabIndex={-1}>
                What does your home need?
              </h2>
              <p className="matcher-intro">Choose the closest match. We will narrow it down from there.</p>
              <div className="matcher-choices">
                {(Object.keys(companyDetails) as CompanyKey[]).map((key, index) => (
                  <button key={key} type="button" onClick={() => setCompany(key)}>
                    <span>0{index + 1}</span>
                    <strong>{companyDetails[key].label}</strong>
                    <Arrow />
                  </button>
                ))}
              </div>
            </>
          )}
          {company && !project && detail && (
            <>
              <button className="matcher-previous" type="button" onClick={() => setCompany(null)}>
                <Arrow reverse /> Back
              </button>
              <p className="eyebrow">Step 2 · Project type</p>
              <h2 id="matcher-title" tabIndex={-1}>
                Tell us a little more.
              </h2>
              <p className="matcher-intro">Which option best describes the work?</p>
              <div className="matcher-choices">
                {detail.options.map((option, index) => (
                  <button key={option} type="button" onClick={() => setProject(option)}>
                    <span>0{index + 1}</span>
                    <strong>{option}</strong>
                    <Arrow />
                  </button>
                ))}
              </div>
            </>
          )}
          {company && project && detail && (
            <div className={`matcher-result matcher-result-${company}`}>
              <button className="matcher-previous" type="button" onClick={() => setProject(null)}>
                <Arrow reverse /> Back
              </button>
              <p className="eyebrow">Your P5 match</p>
              <span className="result-overline">Recommended for · {project}</span>
              <h2 id="matcher-title" tabIndex={-1}>
                {detail.name}
              </h2>
              <p>{detail.reason}</p>
              <div className="result-actions">
                <a
                  className="button button-dark"
                  href={detail.url}
                  target={detail.url.startsWith("http") ? "_blank" : undefined}
                  rel={detail.url.startsWith("http") ? "noopener" : undefined}
                  onClick={() =>
                    track(
                      detail.url.startsWith("http") ? "company_click" : detail.url.startsWith("tel:") ? "phone_click" : "quote_click",
                      { company, location: "matcher" },
                    )
                  }
                >
                  {detail.cta} <Arrow diagonal={detail.url.startsWith("http")} />
                </a>
                <Link
                  className="text-link"
                  href={
                    company === "remodeling" && project === "Kitchen remodel"
                      ? "/quote/kitchen-remodel"
                      : company === "remodeling" && project === "Bathroom remodel"
                        ? "/quote/bathroom-remodel"
                        : company === "remodeling"
                          ? `/quote?project=${project === "Whole-home remodel" ? "whole-home" : "addition-adu-basement"}`
                          : quotePath[company]
                  }
                  onClick={() => track("quote_click", { company, location: "matcher" })}
                >
                  Request a quote from P5 <Arrow />
                </Link>
              </div>
              <button
                className="matcher-why"
                type="button"
                onClick={() => {
                  onClose();
                  document.getElementById(company)?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                See why it fits
              </button>
              <small>No obligation. You are choosing where to continue.</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
