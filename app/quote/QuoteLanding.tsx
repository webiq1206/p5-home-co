import Link from "next/link";

import { CREW_AND_TRADES, QUOTE_SELF_PERFORM, QUOTE_SPECIALTY, SHOW_UNPROVEN_SELF_PERFORM } from "../publicClaims";
import { PROOF_POINTS, TESTIMONIALS } from "./proof";
import { faqsFor, schemaFor, STEPS } from "./schema";
import { QUOTE_SERVICES, type QuoteService } from "./services";
import { serializeJsonLd } from "../structuredData";
import SiteChrome from "@/components/SiteChrome";
import { ShortRequestForm } from "@/components/ShortRequestForm";
import {
  imageVariantFor,
  FEATURED_BOISE_EXTERIOR,
  FEATURED_BOISE_GREAT_ROOM,
  FEATURED_BOISE_KITCHEN,
  FEATURED_BOISE_BATHROOM,
  FEATURED_BOISE_ADU,
} from "../imageVariants.ts";
import { AduLinkedText } from "@/components/AduLinkedText";
import { ADU_D3_LINE } from "../publicIdentity";
import { COVERAGE_LINE } from "../visibilityCopy";

/* eslint-disable @next/next/no-img-element */

/**
 * The quote landing page, shared by /quote and every /quote/<service> variant.
 *
 * A server component on purpose: the headline, the proof, and the answers are
 * in the HTML the server returns, so AI answer engines and crawlers that never
 * run JavaScript still read them. The form is the only client island.
 *
 * The form comes first. Most local paid-search traffic is on a phone, and a
 * visitor who tapped "Request a quote" should see the heading and the first
 * field without scrolling: the page heading, then the form, then everything
 * that explains it. Nobody should scroll past a hero to reach the field they
 * came to fill in.
 */
export default function QuoteLanding({ service }: { service: QuoteService | null;entryLabel?:string;defaultService?:string }) {
  const faqs = faqsFor(service);
  const heroImage = service ? service.image : FEATURED_BOISE_EXTERIOR.src;
  const heroAlt = service ? service.imageAlt : FEATURED_BOISE_EXTERIOR.alt;
  const heroVariant = imageVariantFor(heroImage);
  const others = QUOTE_SERVICES.filter((s) => !service || s.slug !== service.slug);

  return (
    <SiteChrome>
      <div className="quote-page" id="top">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemaFor(service)) }}
        />

        <main className="quote-main">
          {/* The form leads (owner, 1 November): every "Request a quote" lands
              here with the heading and the first field on the first screen, at
              every width. What the hero used to say sits beside the form on
              wide screens and below it on phones, never in front of it. */}
          <section className="quote-request quote-request-first">
            <div className="quote-shell quote-request-inner">
              <div className="quote-request-main">
                {service ? <h1>{service.h1}</h1> : <h1>A specialist team for your home project</h1>}
                <ShortRequestForm
                  id="request-form"
                  formName="Quote Landing Page"
                  defaultProject={service?.project}
                />
              </div>
              <aside className="quote-request-aside" aria-label={service ? `About ${service.label.toLowerCase()} quotes` : "About your quote"}>
                <img
                  className="quote-request-img"
                  src={heroImage}
                  alt={heroAlt}
                  width={heroVariant?.width ?? 1600}
                  height={heroVariant?.height ?? 1000}
                  {...(heroVariant ? { srcSet: heroVariant.srcSet, sizes: "(max-width: 820px) 100vw, 44vw" } : {})}
                  decoding="async"
                />
                <p className="quote-lead">
                  <AduLinkedText
                    text={service
                      ? service.lead
                      : "Tell us what you want done and P5 Home Co sends it to the right specialist team, whether that is a kitchen remodel, a custom home, an ADU, new cabinetry, or a repair. Quotes are free, carry no obligation, and come with a written scope so you can compare them properly."}
                  ></AduLinkedText>
                </p>
                {service && (
                  <ul className="quote-covers" aria-label="What this covers">
                    {service.covers.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </aside>
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

          <section className="quote-photos" aria-labelledby="quote-featured-heading">
            <div className="quote-shell">
              <h2 id="quote-featured-heading" className="quote-photos-heading">Kitchens, living spaces, baths and ADUs</h2>
              <p className="quote-photos-lead">Explore kitchen, great-room, bathroom and ADU layouts, materials and finishes.</p>
              <div className="quote-photo-row">
                <img src={FEATURED_BOISE_KITCHEN.src} alt={FEATURED_BOISE_KITCHEN.alt} width={FEATURED_BOISE_KITCHEN.width} height={FEATURED_BOISE_KITCHEN.height} loading="lazy" decoding="async" />
                <img src={FEATURED_BOISE_GREAT_ROOM.src} alt={FEATURED_BOISE_GREAT_ROOM.alt} width={FEATURED_BOISE_GREAT_ROOM.width} height={FEATURED_BOISE_GREAT_ROOM.height} loading="lazy" decoding="async" />
                <img src={FEATURED_BOISE_BATHROOM.src} alt={FEATURED_BOISE_BATHROOM.alt} width={FEATURED_BOISE_BATHROOM.width} height={FEATURED_BOISE_BATHROOM.height} loading="lazy" decoding="async" />
                <img src={FEATURED_BOISE_ADU.src} alt={FEATURED_BOISE_ADU.alt} width={FEATURED_BOISE_ADU.width} height={FEATURED_BOISE_ADU.height} loading="lazy" decoding="async" />
              </div>
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

          <section className="quote-scroll-photo" aria-hidden="true">
            <img src={FEATURED_BOISE_EXTERIOR.src} alt="" width={FEATURED_BOISE_EXTERIOR.width} height={FEATURED_BOISE_EXTERIOR.height} loading="lazy" decoding="async" />
          </section>

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
                    <a href="#request-form">
                      <b>Something else</b>
                      <span>Describe it and we route it</span>
                    </a>
                  </li>
                )}
              </ul>
              <p className="quote-section-lead quote-others-note">
                P5 Home Co is an operating family of companies, not a directory or a referral
                network.                 {SHOW_UNPROVEN_SELF_PERFORM ? QUOTE_SELF_PERFORM : `${QUOTE_SPECIALTY} ${CREW_AND_TRADES}`}{" "}
                <AduLinkedText text={ADU_D3_LINE}></AduLinkedText>{" "}
                <Link href="/#p5-standard">Read the P5 standard</Link>.
              </p>
            </div>
          </section>

          <section className="quote-faq" aria-labelledby="quote-questions">
            <div className="quote-shell quote-faq-with-photo">
              <div>
                <h2 id="quote-questions">Questions about getting a quote</h2>
                <dl>
                  {faqs.map((item) => (
                    <div key={item.q}>
                      <dt>{item.q}</dt>
                      <dd><AduLinkedText text={item.a}></AduLinkedText></dd>
                    </div>
                  ))}
                </dl>
              </div>
              <img className="quote-faq-photo" src={FEATURED_BOISE_GREAT_ROOM.src} alt={FEATURED_BOISE_GREAT_ROOM.alt} width={FEATURED_BOISE_GREAT_ROOM.width} height={FEATURED_BOISE_GREAT_ROOM.height} loading="lazy" decoding="async" />
            </div>
          </section>

          {/* The service-area line the old quote footer carried; the family footer is shared by every page. */}
          <p className="quote-shell quote-area">
            {service?.slug === "adu"
              ? COVERAGE_LINE
              : "Serving Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden City across Ada and Canyon counties."}
          </p>
        </main>
      </div>
    </SiteChrome>
  );
}
