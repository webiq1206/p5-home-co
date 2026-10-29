import Link from "next/link";

import { CREW_AND_TRADES, QUOTE_SELF_PERFORM, QUOTE_SPECIALTY, SHOW_UNPROVEN_SELF_PERFORM } from "../publicClaims";
import { PROOF_POINTS, TESTIMONIALS } from "./proof";
import { faqsFor, schemaFor, STEPS } from "./schema";
import { QUOTE_SERVICES, type QuoteService } from "./services";
import { serializeJsonLd } from "../structuredData";
import TrackedPhoneLink from "./TrackedPhoneLink";
import PublicIdentity from "@/components/PublicIdentity";
import SaveContactButton from "@/components/SaveContactButton";
import { ShortRequestForm } from "@/components/ShortRequestForm";
import { OpenChatButton } from "@/components/SiteChat";
import {
  imageVariantFor,
  FEATURED_BOISE_EXTERIOR,
  FEATURED_BOISE_GREAT_ROOM,
  FEATURED_BOISE_KITCHEN,
  FEATURED_BOISE_BATHROOM,
  FEATURED_BOISE_ADU,
  TREASURE_VALLEY_FOOTHILLS,
} from "../imageVariants.ts";
import { ADU_D3_LINE, PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS } from "../publicIdentity";

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
export default function QuoteLanding({ service }: { service: QuoteService | null;entryLabel?:string;defaultService?:string }) {
  const faqs = faqsFor(service);
  const heroImage = service ? service.image : FEATURED_BOISE_EXTERIOR.src;
  const heroAlt = service ? service.imageAlt : FEATURED_BOISE_EXTERIOR.alt;
  const heroVariant = imageVariantFor(heroImage);
  const others = QUOTE_SERVICES.filter((s) => !service || s.slug !== service.slug);

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
          <div className="quote-hero-media">
            <img
              className="quote-hero-img"
              src={heroImage}
              alt={heroAlt}
              width={heroVariant?.width ?? 1600}
              height={heroVariant?.height ?? 1000}
              {...(heroVariant ? { srcSet: heroVariant.srcSet, sizes: "(max-width: 820px) 100vw, 48vw" } : {})}
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <div className="quote-hero-panel">
            <div className="quote-shell quote-hero-grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
              <div className="quote-hero-copy">
                <p className="quote-eyebrow">
                  {service
                    ? `${service.label} · Treasure Valley`
                    : "P5 Home Co · Free quote · Treasure Valley"}
                </p>
                {service ? <h2>{service.h1}</h2> : <h1>A specialist team for your home project</h1>}
                <p className="quote-lead">
                  {service
                    ? service.lead
                    : "Tell us what you want done and P5 Home Co routes it to the right specialist team: remodel, custom home, ADU, cabinetry, or repair. Quotes are free, carry no obligation, and come with a written scope."}
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
          </div>
        </section>

        <section className="quote-request" aria-labelledby="quote-request-heading">
          <div className="quote-shell quote-request-inner">
            <div className="quote-request-copy">
              <h2 id="quote-request-heading">Tell us what you need</h2>
              <p>
                Choose your project, leave a short note, and share how to reach you. Add a photo or plan if you have
                one.
              </p>
            </div>
            <ShortRequestForm
              id="request-form"
              formName="Quote Landing Page"
              defaultProject={service?.project}
            />
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
            <h2 id="quote-featured-heading" className="quote-photos-heading">One foothills home, room by room</h2>
            <p className="quote-photos-lead">A cohesive Boise-area custom home shown room by room, so the kitchen, great room, bath, and ADU read as the same property. Representative design.</p>
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

        <section className="quote-photos quote-photos-compact" aria-label="Treasure Valley setting">
          <div className="quote-shell quote-photo-row quote-photo-row-single">
            <img src={TREASURE_VALLEY_FOOTHILLS.src} alt={TREASURE_VALLEY_FOOTHILLS.alt} width={TREASURE_VALLEY_FOOTHILLS.width} height={TREASURE_VALLEY_FOOTHILLS.height} loading="lazy" decoding="async" />
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
              network. {SHOW_UNPROVEN_SELF_PERFORM ? QUOTE_SELF_PERFORM : `${QUOTE_SPECIALTY} ${CREW_AND_TRADES}`}{" "}
              {ADU_D3_LINE}{" "}
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
                    <dd>{item.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <img className="quote-faq-photo" src={FEATURED_BOISE_GREAT_ROOM.src} alt={FEATURED_BOISE_GREAT_ROOM.alt} width={FEATURED_BOISE_GREAT_ROOM.width} height={FEATURED_BOISE_GREAT_ROOM.height} loading="lazy" decoding="async" />
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
              <SaveContactButton className="quote-save-contact" location="quote_footer" />
              <Link href="/">P5 Home Co home</Link>
              <Link href="/about">About</Link>
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
