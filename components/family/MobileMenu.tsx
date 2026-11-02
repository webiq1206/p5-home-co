'use client';
/**
 * Family mobile menu. SHARED FILE (lib/family/manifest.json).
 *
 * A modal dialog over the whole screen: navigation at 28px in the display face,
 * then Call / Text / Chat tiles, the primary CTA and Save contact. Focus moves
 * into the dialog, Tab is trapped inside it, Escape closes it and focus returns
 * to the menu button. The page behind does not scroll while it is open.
 */
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { isActiveHref } from '@/lib/family/types';
import { brandStyle } from './brandStyle';
import { FamilyButton } from './Button';
import { ChatIcon, CloseIcon, ContactCardIcon, PhoneIcon, TextIcon } from './Icons';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface MobileMenuProps {
  open: boolean;
  pathname: string | null;
  /** returnFocus: true when the visitor dismissed the menu (Escape, close button). */
  onClose: (returnFocus: boolean) => void;
  onCta: () => void;
  onChat: () => void;
}

export function MobileMenu({ open, pathname, onClose, onCta, onChat }: MobileMenuProps) {
  const brand = FAMILY_BRAND;
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.body.dataset.familyMenuOpen = 'true';
    closeButton.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(true);
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = previousOverflow;
      delete document.body.dataset.familyMenuOpen;
    };
  }, [open, onClose]);

  // Open only ever becomes true after a click, so document exists whenever this renders.
  if (!open || typeof document === 'undefined') return null;

  const tiles = (
    <div className="fam-menu-tiles" data-count={brand.chat.enabled ? 3 : 2}>
      <a href={brand.phone.telHref} className="fam-menu-tile" data-testid="link-phone-mobile-menu">
        <PhoneIcon />
        <span>Call</span>
      </a>
      <a href={brand.phone.smsHref} className="fam-menu-tile" data-testid="link-text-mobile-menu">
        <TextIcon />
        <span>Text</span>
      </a>
      {brand.chat.enabled ? (
        <button
          type="button"
          className="fam-menu-tile"
          onClick={() => {
            onClose(false);
            onChat();
          }}
          data-testid="button-chat-mobile-menu"
        >
          <ChatIcon />
          <span>{brand.chat.label}</span>
        </button>
      ) : null}
    </div>
  );

  return createPortal(
    <div className="fam-menu-layer" style={brandStyle()}>
      <div
        ref={dialog}
        id="family-mobile-menu"
        className="fam-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        data-testid="mobile-nav-drawer"
      >
        <div className="fam-menu-top">
          <Link href="/" className="fam-header-logo" aria-label={`${brand.lockupLabel}, home`} onClick={() => onClose(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- vector lockup at its own aspect ratio */}
            <img src={brand.lockup.onLight.src} width={brand.lockup.onLight.width} height={brand.lockup.onLight.height} alt="" />
          </Link>
          <button
            ref={closeButton}
            type="button"
            className="fam-header-icon"
            aria-label="Close navigation menu"
            onClick={() => onClose(true)}
            data-testid="button-mobile-menu-close"
          >
            <CloseIcon size={22} />
          </button>
        </div>

        <nav className="fam-menu-nav" aria-label="Menu">
          <ul>
            {brand.nav.map((link) => {
              const active = isActiveHref(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onClose(false)}
                    data-testid={`link-mobile-nav-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="fam-menu-foot">
          {tiles}
          <FamilyButton
            href={brand.cta.href}
            variant="primary"
            size="lg"
            block
            onClick={() => {
              onCta();
              onClose(false);
            }}
            data-testid="button-mobile-menu-cta"
          >
            {brand.cta.label}
          </FamilyButton>
          {brand.saveContactHref ? (
            <a href={brand.saveContactHref} className="fam-menu-save" data-testid="link-save-contact">
              <ContactCardIcon size={18} />
              Save our contact
            </a>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
