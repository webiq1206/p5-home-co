'use client';
/**
 * Family site header. SHARED FILE (lib/family/manifest.json): every brand
 * difference comes from lib/familyBrand.ts.
 *
 * C6 / B6: sticky, 64px on phones and 76px from 640px, lockup left, 15px
 * navigation, one 44px filled CTA. Below the brand's desktop width the
 * navigation folds into the menu, and Call (icon and label) plus the brand's
 * other compact actions sit beside a 44px menu button. Dark over photo heroes,
 * light everywhere else. It never hides on scroll, so the lockup is never clipped.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { isActiveHref, matchesRoute } from '@/lib/family/types';
import { brandStyle } from './brandStyle';
import { FamilyButton } from './Button';
import { MenuIcon } from './Icons';
import { ContactActions } from './ContactActions';
import { MobileMenu } from './MobileMenu';
import { trackFamilyEvent } from './track';

export function SiteHeader({ tone: toneOverride }: { tone?: 'dark' | 'light' }) {
  const brand = FAMILY_BRAND;
  const pathname = usePathname();
  const tone = toneOverride ?? (matchesRoute(pathname, brand.header.darkOn) ? 'dark' : 'light');
  const lockup = brand.lockup.onDark;
  // The menu is open for the page it was opened on, so any route change closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn !== null && openOn === pathname;
  const trigger = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const inset = parseFloat(getComputedStyle(header).paddingTop) || 0;
      document.documentElement.style.setProperty('--header-height', `${Math.ceil(header.getBoundingClientRect().height - inset)}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--header-height');
    };
  }, []);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpenOn(null);
    if (returnFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  // The menu belongs to the compact header; it closes when the window reaches the desktop layout.
  useEffect(() => {
    const desktop = window.matchMedia(`(min-width: ${brand.header.desktopFrom}px)`);
    const onChange = () => {
      if (desktop.matches) setOpenOn(null);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [brand.header.desktopFrom]);

  const onCta = (surface: 'header' | 'mobile-menu') => {
    trackFamilyEvent(brand.analytics.ctaEvent, { location: pathname ?? '', surface });
  };
  const openChat = () => window.dispatchEvent(new Event(brand.chat.openEvent));

  return (
    <header
      ref={headerRef}
      className="fam-header"
      data-family-header=""
      data-tone={tone}
      data-desktop-from={brand.header.desktopFrom}
      style={brandStyle()}
    >
      <div className="fam-header-inner">
        <Link href="/" className="fam-header-logo" aria-label={`${brand.lockupLabel}, home`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- vector lockup at its own aspect ratio */}
          <img src={lockup.src} width={lockup.width} height={lockup.height} alt="" />
          <span className="fam-header-narrow-name">{brand.name}</span>
        </Link>

        <nav className="fam-header-nav" aria-label="Main">
          <ul>
            {brand.nav.map((link) => {
              const active = isActiveHref(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link href={link.href} aria-current={active ? 'page' : undefined} className="fam-header-link">
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="fam-header-cta">
          <FamilyButton
            href={brand.cta.href}
            variant="hero"
            size="md"
            onClick={() => onCta('header')}
            data-testid="button-header-cta"
          >
            {brand.cta.label}
          </FamilyButton>
        </div>

        <ContactActions surface="header" />
        <div className="fam-header-compact">
          <button
            ref={trigger}
            type="button"
            className="fam-header-icon"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="family-mobile-menu"
            onClick={() => setOpenOn(pathname ?? '')}
            data-testid="button-mobile-menu-open"
          >
            <MenuIcon size={22} />
          </button>
        </div>
      </div>

      <MobileMenu
        open={menuOpen}
        pathname={pathname}
        onClose={closeMenu}
        onCta={() => onCta('mobile-menu')}
        onChat={openChat}
      />
    </header>
  );
}
