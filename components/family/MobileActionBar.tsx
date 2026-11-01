'use client';
/**
 * Family mobile action bar (C7). SHARED FILE (lib/family/manifest.json).
 *
 * Phones and tablets only, retired at the brand's desktop width. Call (icon and
 * label) plus the one primary CTA, 48px buttons, 12px padding plus the bottom
 * safe area. Whether it shows over the hero is a brand decision
 * (bar.showOverHero); otherwise it appears once the hero's own primary CTA
 * ([data-hero-cta="primary"]) has left the viewport. It steps aside while the
 * menu is open, while a text field has focus and while any interface the brand
 * names in bar.yieldToBodyFlags owns the screen. A spacer of the same height
 * keeps the end of the page reachable. With bar.hideInstantly it carries
 * data-hide="instant" and leaves at once instead of sliding out. Keep the
 * data-mobile-nav-bar attribute: site checks and other components find the bar
 * by it.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { matchesRoute } from '@/lib/family/types';
import { brandStyle } from './brandStyle';
import { FamilyButton, familyButtonClass } from './Button';
import { PhoneIcon } from './Icons';
import { trackFamilyEvent } from './track';

const TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]),textarea,select,[contenteditable=""],[contenteditable="true"]';

function typing(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.matches(TEXT_ENTRY);
}

/** Body data flags plus focus, as an external store: true while something else needs the bottom of the screen. */
function subscribeYield(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true });
  document.addEventListener('focusin', onChange);
  document.addEventListener('focusout', onChange);
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', onChange);
    document.removeEventListener('focusout', onChange);
  };
}

function yieldSnapshot(flags: string[]): boolean {
  const data = document.body.dataset;
  return data.familyMenuOpen === 'true' || flags.some((flag) => data[flag] === 'true') || typing();
}

export function MobileActionBar() {
  const brand = FAMILY_BRAND;
  const { bar } = brand;
  const pathname = usePathname();
  const hiddenHere = matchesRoute(pathname, bar.hiddenOn);
  // Which page the hero CTA was last seen leaving, so a route change starts hidden again.
  const [pastHeroOn, setPastHeroOn] = useState<string | null>(null);
  const pastHeroCta = pastHeroOn !== null && pastHeroOn === pathname;
  const yielding = useSyncExternalStore(
    subscribeYield,
    () => yieldSnapshot(bar.yieldToBodyFlags),
    () => false,
  );

  // Without showOverHero, wait until the hero's own CTA has scrolled out of view.
  useEffect(() => {
    if (hiddenHere || bar.showOverHero) return;
    const path = pathname ?? '';
    const target = document.querySelector('[data-hero-cta="primary"]');
    if (!target || typeof IntersectionObserver === 'undefined') {
      // No hero CTA on this page: the bar is the page's CTA from the start.
      const frame = window.requestAnimationFrame(() => setPastHeroOn(path));
      return () => window.cancelAnimationFrame(frame);
    }
    // The sticky header covers the top of the viewport, so a CTA under it has already left view.
    const header = document.querySelector<HTMLElement>('[data-family-header]');
    const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const top = entry.rootBounds?.top ?? headerHeight;
        setPastHeroOn(!entry.isIntersecting && entry.boundingClientRect.top < top ? path : null);
      },
      { rootMargin: `-${headerHeight}px 0px 0px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hiddenHere, bar.showOverHero, pathname]);

  if (hiddenHere) return null;
  const visible = (bar.showOverHero || pastHeroCta) && !yielding;

  return (
    <>
      <div className="fam-bar-spacer" data-desktop-from={brand.header.desktopFrom} aria-hidden="true" />
      <div
        className="fam-bar"
        data-mobile-nav-bar=""
        data-family-bar=""
        data-state={visible ? 'visible' : 'hidden'}
        data-hide={bar.hideInstantly ? 'instant' : undefined}
        data-desktop-from={brand.header.desktopFrom}
        aria-hidden={visible ? undefined : true}
        style={brandStyle()}
      >
        <div className="fam-bar-inner">
          <a
            href={brand.phone.telHref}
            className={familyButtonClass({ variant: 'secondary', size: 'lg', tone: 'dark', className: 'fam-bar-call' })}
            aria-label={`${bar.callLabel} ${brand.phone.display}`}
            tabIndex={visible ? undefined : -1}
            data-testid="button-call-mobile"
          >
            <PhoneIcon size={18} />
            <span>{bar.callLabel}</span>
          </a>
          <FamilyButton
            href={brand.cta.href}
            variant="hero"
            size="lg"
            className="fam-bar-primary"
            tabIndex={visible ? undefined : -1}
            onClick={() => trackFamilyEvent(brand.analytics.barCtaEvent, { location: pathname ?? '', surface: 'mobile-sticky' })}
            data-testid="button-begin-conversation-mobile"
          >
            {brand.cta.label}
          </FamilyButton>
        </div>
      </div>
    </>
  );
}
