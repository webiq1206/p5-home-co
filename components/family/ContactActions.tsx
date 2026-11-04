'use client';

/** One accessible contact vocabulary for every family header and footer. */
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { matchesRoute } from '@/lib/family/types';
import { ChatIcon, PhoneIcon, TextIcon } from './Icons';

export function ContactActions({ surface }: { surface: 'header' | 'footer' }) {
  const brand = FAMILY_BRAND;
  const pathname = usePathname();
  const showChat = brand.chat.enabled && !matchesRoute(pathname, brand.chat.hiddenOn ?? []);
  const footer = surface === 'footer';
  const returnFocusObserver = useRef<MutationObserver | null>(null);
  useEffect(() => () => returnFocusObserver.current?.disconnect(), []);
  const openChat = (opener: HTMLButtonElement) => {
    returnFocusObserver.current?.disconnect();
    let opened = false;
    let openedDialog: HTMLElement | null = null;
    const visible = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;
    const existingDialogs = new Set([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible));
    const observer = new MutationObserver(() => {
      if (!openedDialog) openedDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(element => visible(element) && !existingDialogs.has(element)) ?? null;
      const active = document.body.dataset.assistantOpen === 'true' || document.body.dataset.p5ChatOpen === 'true' || Boolean(openedDialog && visible(openedDialog));
      if (active) opened = true;
      if (opened && !active) {
        observer.disconnect();
        window.requestAnimationFrame(() => {
          if (opener.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus();
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-assistant-open', 'data-p5-chat-open', 'aria-hidden', 'data-state', 'style', 'class'] });
    returnFocusObserver.current = observer;
    window.dispatchEvent(new Event(brand.chat.openEvent));
  };

  return (
    <div className={`fam-contact-actions fam-contact-actions--${surface}`} aria-label="Contact options">
      <a
        className="fam-contact-action"
        href={brand.phone.telHref}
        aria-label={`Call ${brand.phone.display}`}
        title={`Call ${brand.phone.display}`}
        data-testid={footer ? 'link-footer-call' : 'link-call-mobile-header'}
      >
        <PhoneIcon />
        <span className="fam-contact-label">Call</span>
      </a>
      <a
        className="fam-contact-action"
        href={brand.phone.smsHref}
        aria-label={`Text ${brand.phone.display}`}
        title={`Text ${brand.phone.display}`}
        data-testid={footer ? 'link-footer-text' : 'link-text-mobile-header'}
      >
        <TextIcon />
        <span className="fam-contact-label">Text</span>
      </a>
      {showChat ? (
        <button
          className="fam-contact-action"
          type="button"
          aria-label={brand.chat.label}
          title={brand.chat.label}
          onClick={(event) => openChat(event.currentTarget)}
          data-testid={footer ? 'button-chat-footer' : 'button-chat-mobile-header'}
        >
          <ChatIcon />
          <span className="fam-contact-label">Chat</span>
        </button>
      ) : null}
    </div>
  );
}
