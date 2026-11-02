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
 * names in bar.yieldToBodyFlags owns the screen. It also steps aside while any
 * element marked [data-family-bar-yield] (a quote form, its success screen or
 * its Step 2 panel) is in the viewport: the bar would only repeat the form, and
 * a tap at the bottom edge after leaving a field must reach the form, not the
 * bar. That uses one IntersectionObserver (no layout reads); marked elements
 * that mount later are picked up on the next frame. A spacer of the same height
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

const YIELD_TARGET = '[data-family-bar-yield]';

/** True while any [data-family-bar-yield] element intersects the viewport. */
function useYieldTargetOnScreen(): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const showing = new Set<Element>();
    const watched = new Set<Element>();
    const publish = () => setOnScreen(showing.size > 0);
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showing.add(entry.target);
        else showing.delete(entry.target);
      }
      publish();
    });
    let frame = 0;
    // Forms swap to a success screen and Step 2 mounts later, so re-scan (at
    // most once a frame) when the page's elements change.
    const scan = () => {
      frame = 0;
      const current = new Set(document.querySelectorAll(YIELD_TARGET));
      for (const el of current) if (!watched.has(el)) { watched.add(el); io.observe(el); }
      for (const el of [...watched]) {
        if (current.has(el)) continue;
        watched.delete(el);
        showing.delete(el);
        io.unobserve(el);
      }
      publish();
    };
    const mutations = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutations.disconnect();
      io.disconnect();
    };
  }, []);
  return onScreen;
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
  const formOnScreen = useYieldTargetOnScreen();

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
  const visible = (bar.showOverHero || pastHeroCta) && !yielding && !formOnScreen;

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
