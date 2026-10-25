import Link from "next/link";

import {P5Estimator} from "@/components/P5Estimator";

import { CREW_AND_TRADES, QUOTE_SELF_PERFORM, QUOTE_SPECIALTY, SHOW_UNPROVEN_SELF_PERFORM } from "../publicClaims";
import { PROOF_POINTS, TESTIMONIALS } from "./proof";
import { faqsFor, schemaFor, STEPS } from "./schema";
import { QUOTE_SERVICES, type QuoteService } from "./services";
import { serializeJsonLd } from "../structuredData";
import TrackedPhoneLink from "./TrackedPhoneLink";
import PublicIdentity from "@/components/PublicIdentity";
import { ShortRequestForm } from "@/components/ShortRequestForm";
import { OpenChatButton } from "@/components/SiteChat";
import { imageVariantFor } from "../imageVariants.ts";
import { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS } from "../publicIdentity";

/* eslint-disable @next/next/no-img-element */

/**
 * The quote landing page, shared by /quote and every /quote/<service> variant.
 *
 * A server component on purpose: the headline, the proof, and the answers are
 * in the HTML the server returns, so AI answer engines and crawlers that never
 * run JavaScript still read them. The form is the only client island.
 *
 * Mobile ordering is deliberate. Most local paid-search traffic is on a phone,
 * so the hero carries only the headline and the direct answer before the form;
 * the longer trust and process content sits below it. Nobody should have to
 * scroll past six paragraphs to reach the field they came to fill in.
 */
export default function QuoteLanding({ service, entryLabel, defaultService }: { service: QuoteService | null;entryLabel?:string;defaultService?:string }) {
  const faqs = faqsFor(service);
  const heroImage = service ? service.image : "/images/p5-hero.webp";
  const heroAlt = service
    ? service.imageAlt
    : "Modern two-story house with dark vertical siding, a flat roof, and warm window light at dusk.";
  const heroVariant = imageVariantFor(heroImage);
  const others = QUOTE_SERVICES.filter((s) => !service || s.slug !== service.slug);
  const serviceDefaults: Record<string, string> = {
    "kitchen-remodel": "kitchen",
    "bathroom-remodel": "bathroom",
    "home-addition": "addition",
    adu: "adu",
    "custom-home": "new-construction",
    "new-construction": "new-construction",
    "custom-cabinets": "cabinet-install",
    handyman: "handyman",
    "re-10": "re10",
  };
  const resolvedService = defaultService ?? serviceDefaults[service?.slug || ""] ?? "";

  return (
    <>
      <a className="quote-skip" href="#request-form">
        Skip to the request form
      </a>

      <main className="quote-page" id="top">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemaFor(service)) }}
        />

        <header className="quote-header">
          <Link className="quote-wordmark" href="/" aria-label="P5 Home Co, home">
            <img src="/brands/p5-home-co-lockup-dark.svg" alt="P5 Home Co, The Home Company" />
          </Link>
          <div className="quote-header-actions">
            <TrackedPhoneLink
              className="quote-header-phone"
              location="quote_header"
              ariaLabel="Call P5 Home Co on 2 0 8, 4 7 7, 1 1 6 9"
            >
              (208) 477-1169
            </TrackedPhoneLink>
            <OpenChatButton className="quote-header-text" location="quote_header">Chat</OpenChatButton>
            <a className="quote-header-text" href={PUBLIC_PHONE_SMS} aria-label={`Text ${PUBLIC_PHONE_DISPLAY}`}>
              Text
            </a>
          </div>
        </header>

        <section className="quote-hero">
          <img
            className="quote-hero-img"
            src={heroImage}
            alt={heroAlt}
            width={heroVariant?.width ?? 1600}
            height={heroVariant?.height ?? 1000}
            {...(heroVariant ? { srcSet: heroVariant.srcSet, sizes: "100vw" } : {})}
            fetchPriority="high"
            decoding="async"
          />
          <div className="quote-hero-veil" aria-hidden="true" />

          <div className="quote-shell">
            <div className="quote-contact-card">
              <p className="quote-eyebrow">
                {service
                  ? `${service.label} · Treasure Valley`
                  : "Free quote · Treasure Valley, Idaho"}
              </p>
              {service ? <h2>{service.h1}</h2> : <h1>A specialist team for your home project</h1>}
              <p className="quote-contact-note">Add a photo or plan if you have one.</p>
              <div className="quote-contact-actions">
                <TrackedPhoneLink className="button button-dark" location="quote_hero">Call (208) 477-1169</TrackedPhoneLink>
                <OpenChatButton className="button button-dark" location="quote_hero">Chat</OpenChatButton>
              </div>
              <ShortRequestForm
                id="request-form"
                formName="Quote Landing Page"
                defaultProject={service?.project}
                plain
                compact
              />
              <p className="quote-lead">
                {service
                  ? service.lead
                  : "Tell us what you want done and P5 Home Co sends it to the right specialist team, whether that is a kitchen remodel, a custom home, an ADU, new cabinetry, or a repair. Quotes are free, carry no obligation, and come with a written scope so you can compare them properly."}
              </p>

              {service && (
                <ul className="quote-covers" aria-label="What this covers">
                  {service.covers.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}

              <p className="quote-hero-call">
                Prefer to talk it through?{" "}
                <TrackedPhoneLink location="quote_hero">Call (208) 477-1169</TrackedPhoneLink>
              </p>
            </div>
          </div>
        </section>

        <section id="quote-form-heading" className="quote-tool">
          <div className="quote-shell quote-tool-intro">
            <h2>Project details, if you want them</h2>
            <p>This step is optional. A name and phone above are enough for a person to follow up.</p>
          </div>
          <div className="quote-tool-frame">
            <P5Estimator headingAs={service ? "h1" : "h2"} layout="embedded" entryLabel={entryLabel} defaultService={resolvedService} />
          </div>
        </section>

        <section className="quote-proof" aria-labelledby="why-p5">
          <div className="quote-shell">
            <h2 id="why-p5">Why homeowners let us price it</h2>
            <ul className="quote-proof-grid">
              {PROOF_POINTS.map((point) => (
                <li key={point.label}>
                  <b>{point.label}</b>
                  <span>{point.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="quote-photos" aria-label="Recent home work">
          <div className="quote-shell quote-photo-row">
            <img src="/images/p5-bathroom.webp" alt="Bathroom with a glass walk-in shower, a freestanding tub, and a light wood vanity." loading="lazy" decoding="async" />
            <img src="/images/p5-addition.webp" alt="Living room with a vaulted wood ceiling and a floor-to-ceiling stone fireplace." loading="lazy" decoding="async" />
            <img src="/images/p5-adu.webp" alt="Small modern building with light board-and-batten siding, a dark metal roof, cedar trim, and a covered entry." loading="lazy" decoding="async" />
          </div>
        </section>

        {TESTIMONIALS.length > 0 && (
          <section className="quote-voices" aria-labelledby="in-their-words">
            <div className="quote-shell">
              <h2 id="in-their-words">In their words</h2>
              <ul className="quote-voice-grid">
                {TESTIMONIALS.map((t) => (
                  <li key={t.quote}>
                    <blockquote>{t.quote}</blockquote>
                    <p className="quote-voice-who">
                      <b>{t.name}</b>
                      <span>{t.context}</span>
                      {t.sourceUrl && (
                        <a href={t.sourceUrl} rel="nofollow noopener" target="_blank">
                          Verify
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="quote-steps" aria-labelledby="what-happens">
          <div className="quote-shell">
            <h2 id="what-happens">What happens after you send this</h2>
            <ol className="quote-step-grid">
              {STEPS.map((step) => (
                <li key={step.n}>
                  <b aria-hidden="true">{step.n}</b>
                  <h3>{step.h}</h3>
                  <p>{step.p}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="quote-others" aria-labelledby="other-work">
          <div className="quote-shell">
            <h2 id="other-work">{service ? "We also quote" : "Get a quote for"}</h2>
            <ul className="quote-other-grid">
              {others.map((s) => (
                <li key={s.slug}>
                  <Link href={`/quote/${s.slug}`}>
                    <b>{s.label}</b>
                    <span>{s.brand}</span>
                  </Link>
                </li>
              ))}
              {!service && (
                <li key="something-else">
                  <a href="#quote-form-heading">
                    <b>Something else</b>
                    <span>Describe it and we route it</span>
                  </a>
                </li>
              )}
            </ul>
            <p className="quote-section-lead quote-others-note">
              P5 Home Co is an operating family of five companies, not a directory or a referral
              network. {SHOW_UNPROVEN_SELF_PERFORM ? QUOTE_SELF_PERFORM : `${QUOTE_SPECIALTY} ${CREW_AND_TRADES}`}{" "}
              <Link href="/#p5-standard">Read the P5 standard</Link>.
            </p>
          </div>
        </section>

        <section className="quote-faq" aria-labelledby="quote-questions">
          <div className="quote-shell">
            <h2 id="quote-questions">Questions about getting a quote</h2>
            <dl>
              {faqs.map((item) => (
                <div key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <footer className="quote-footer">
          <div className="quote-shell">
            <p className="quote-footer-brand">P5 Home Co</p>
            <p>
              Serving Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden
              City across Ada and Canyon counties.
            </p>
            <p className="quote-footer-links">
              <a href="tel:+12084771169">(208) 477-1169</a>
              <a href="mailto:hello@p5homeco.com">hello@p5homeco.com</a>
              <Link href="/">P5 Home Co home</Link>
              <Link href="/legal/privacy">Privacy policy</Link>
            </p>
            <PublicIdentity />
            <p className="quote-footer-bottom">© 2026 P5 Home Co. All rights reserved.</p>
          </div>
        </footer>
      </main>

      
    </>
  );
}
