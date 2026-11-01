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
import { ChatIcon, MenuIcon, PhoneIcon, TextIcon } from './Icons';
import { MobileMenu } from './MobileMenu';
import { trackFamilyEvent } from './track';

export function SiteHeader({ tone: toneOverride }: { tone?: 'dark' | 'light' }) {
  const brand = FAMILY_BRAND;
  const pathname = usePathname();
  const tone = toneOverride ?? (matchesRoute(pathname, brand.header.darkOn) ? 'dark' : 'light');
  const lockup = tone === 'dark' ? brand.lockup.onDark : brand.lockup.onLight;
  // The menu is open for the page it was opened on, so any route change closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn !== null && openOn === pathname;
  const trigger = useRef<HTMLButtonElement>(null);

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
            variant={tone === 'dark' ? 'hero' : 'primary'}
            size="md"
            onClick={() => onCta('header')}
            data-testid="button-header-cta"
          >
            {brand.cta.label}
          </FamilyButton>
        </div>

        <div className="fam-header-compact">
          {brand.header.phoneActions.map((action) => {
            if (action === 'call') {
              return (
                <a
                  key="call"
                  href={brand.phone.telHref}
                  className="fam-header-call"
                  aria-label={`Call ${brand.phone.display}`}
                  data-testid="link-call-mobile-header"
                >
                  <PhoneIcon size={18} />
                  <span>{brand.bar.callLabel}</span>
                </a>
              );
            }
            if (action === 'text') {
              return (
                <a
                  key="text"
                  href={brand.phone.smsHref}
                  className="fam-header-icon fam-header-icon--extra"
                  aria-label={`Text ${brand.phone.display}`}
                  data-testid="link-text-mobile-header"
                >
                  <TextIcon />
                </a>
              );
            }
            if (!brand.chat.enabled) return null;
            return (
              <button
                key="chat"
                type="button"
                className="fam-header-icon fam-header-icon--extra"
                aria-label={brand.chat.label}
                onClick={openChat}
                data-testid="button-chat-mobile-header"
              >
                <ChatIcon />
              </button>
            );
          })}
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
