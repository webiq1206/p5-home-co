/**
 * Family photo hero (draft-hero.md template). SHARED FILE (lib/family/manifest.json).
 *
 * Height: min(900px, 100svh minus the header) on desktop; below the brand's
 * desktop width, 100svh minus the header and the bottom bar with a 560px floor,
 * never 100vh under a header. Full-bleed photograph through next/image with
 * priority and an optional art-directed phone crop. Directional scrim: 90deg
 * ink .85 to .55 at 42% to clear at 78% on desktop; vertical on phones and
 * tablets, keeping the upper 40% of the photo clear. Copy: eyebrow, Display H1
 * with an optional accent second line, one support line (14 words at most), one
 * 48px primary button, one text link and at most one microcopy line.
 *
 * Server-renderable: no hooks, so the image and H1 are in the first HTML.
 */
import { getImageProps } from 'next/image';
import type { CSSProperties } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { brandStyle } from './brandStyle';
import { FamilyButton } from './Button';

export interface HeroPhotoImage {
  src: string;
  width: number;
  height: number;
  /** CSS object-position, for example "60% 40%". */
  position?: string;
  /**
   * Serve this already-sized file as is, bypassing the image optimizer
   * (/_next/image): no responsive srcset, the browser fetches src directly.
   * For a file already encoded near display size (WebP or JPEG), where a
   * stalled optimizer request would hold the page's load event open.
   */
  unoptimized?: boolean;
}

export interface HeroPhotoProps {
  image: HeroPhotoImage & { alt: string };
  /** Portrait crop used below 1024px; the subject stays in frame on a phone. */
  phoneImage?: HeroPhotoImage;
  eyebrow: string;
  title: string;
  /** Second declarative, set on its own line in the brand accent. */
  titleAccent?: string;
  support?: string;
  primary: { label: string; href: string };
  link?: { label: string; href: string };
  microcopy?: string;
  /** 'strong' deepens the desktop scrim for a bright photograph; measure contrast before choosing it. */
  scrim?: 'standard' | 'strong';
}

const PHONE_QUERY = '(max-width: 1023px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

/** Preload the optimizer's responsive set, or the plain file when the image is unoptimized. */
function preloadAttrs(image: { src?: string; srcSet?: string }) {
  return image.srcSet ? { imageSrcSet: image.srcSet, imageSizes: '100vw' } : { href: image.src };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function HeroPhoto({ image, phoneImage, eyebrow, title, titleAccent, support, primary, link, microcopy, scrim = 'standard' }: HeroPhotoProps) {
  if (support && wordCount(support) > 14 && process.env.NODE_ENV !== 'production') {
    console.warn(`HeroPhoto: support line is ${wordCount(support)} words; the template allows 14.`);
  }
  const common = { alt: image.alt, sizes: '100vw', quality: 75 } as const;
  const { props: desktop } = getImageProps({ ...common, src: image.src, width: image.width, height: image.height, unoptimized: image.unoptimized, priority: true });
  const phone = phoneImage
    ? getImageProps({ ...common, src: phoneImage.src, width: phoneImage.width, height: phoneImage.height, unoptimized: phoneImage.unoptimized, priority: true }).props
    : null;

  return (
    <section
      className="fam-hero"
      data-family-hero=""
      data-desktop-from={FAMILY_BRAND.header.desktopFrom}
      data-scrim={scrim}
      style={brandStyle()}
      aria-labelledby="family-hero-title"
    >
      {phone ? (
        <link rel="preload" as="image" {...preloadAttrs(phone)} media={PHONE_QUERY} fetchPriority="high" />
      ) : null}
      <link
        rel="preload"
        as="image"
        {...preloadAttrs(desktop)}
        media={phone ? DESKTOP_QUERY : undefined}
        fetchPriority="high"
      />
      <picture className="fam-hero-media">
        {phone ? <source media={PHONE_QUERY} srcSet={phone.srcSet ?? phone.src} sizes={phone.srcSet ? '100vw' : undefined} width={phone.width} height={phone.height} /> : null}
        <img
          {...desktop}
          alt={image.alt}
          loading="eager"
          fetchPriority="high"
          className="fam-hero-img"
          style={
            {
              '--hero-position': image.position ?? '50% 50%',
              '--hero-position-phone': phoneImage?.position ?? image.position ?? '50% 50%',
            } as CSSProperties
          }
        />
      </picture>
      <div className="fam-hero-scrim" aria-hidden="true" />
      <div className="fam-hero-inner">
        <div className="fam-hero-copy">
          <p className="fam-hero-eyebrow">{eyebrow}</p>
          <h1 className="fam-hero-title" id="family-hero-title">
            {title}
            {titleAccent ? (
              <>
                {' '}
                <span className="fam-hero-accent">{titleAccent}</span>
              </>
            ) : null}
          </h1>
          {support ? <p className="fam-hero-support">{support}</p> : null}
          <div className="fam-hero-actions">
            <FamilyButton href={primary.href} variant="hero" size="lg" data-hero-cta="primary" data-cta="primary">
              {primary.label}
            </FamilyButton>
            {link ? (
              <a href={link.href} className="fam-hero-link">
                {link.label}
              </a>
            ) : null}
          </div>
          {microcopy ? <p className="fam-hero-micro">{microcopy}</p> : null}
        </div>
      </div>
    </section>
  );
}
