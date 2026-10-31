"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Arrow from "@/components/Arrow";
import PublicIdentity from "@/components/PublicIdentity";
import SaveContactButton from "@/components/SaveContactButton";
import { OpenChatButton } from "@/components/SiteChat";
import { track } from "@/app/analytics";
import {
  PUBLIC_PHONE_DISPLAY,
  PUBLIC_PHONE_SMS,
  PUBLIC_PHONE_TEL,
} from "@/app/publicIdentity";

const HeaderWordmark = ({ dark = false }: { dark?: boolean }) => (
  <Link className="wordmark" href="/" aria-label="P5 Home Co, home">
    <img className="p5-header-logo" src={dark ? "/brands/p5-home-co-lockup-light.svg" : "/brands/p5-home-co-lockup-dark.svg"} alt="P5 Home Co, The Home Company" />
    <img className="p5-header-icon" src="/brands/p5-home-co-icon-dark.svg" alt="P5 Home Co monogram" />
  </Link>
);

function ContactIcon({kind}: {kind: "call" | "text" | "chat"}) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "call" ? <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /> : <><path d="M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />{kind === "text" ? <path d="M7 7h10M7 11h7" /> : <path d="M7 10h.01M12 10h.01M17 10h.01" />}</>}
  </svg>;
}

const FooterWordmark = () => (
  <Link className="wordmark" href="/" aria-label="P5 Home Co, home">
    <img className="p5-footer-logo" src="/brands/p5-home-co-lockup-light.svg" alt="P5 Home Co, The Home Company" />
  </Link>
);

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        track("company_click", {
          company: href.replace(/^https:\/\/|\.co$/g, ""),
          location: "footer",
        })
      }
    >
      {children} <Arrow diagonal />
    </a>
  );
}

/** Shared header, mobile menu, and footer for public marketing pages. */
export default function SiteChrome({
  children,
  onOpenMatcher,
  imageHero = false,
}: {
  children: React.ReactNode;
  onOpenMatcher?: () => void;
  imageHero?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const focusable = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []).filter(
        (el) => el.offsetParent !== null,
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = [menuButtonRef.current, ...focusable()].filter(Boolean) as HTMLElement[];
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const trigger = menuButtonRef.current;
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 821px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className={`site-header ${imageHero ? "site-header-image-hero" : ""} ${scrolled ? "site-header-scrolled" : ""}`}>
        <div className="nav-shell">
          <HeaderWordmark dark={imageHero} />
          <nav className="desktop-nav" aria-label="Primary navigation">
            <Link href="/#companies">Our companies</Link>
            <Link href="/#p5-standard">The P5 standard</Link>
            <Link href="/about">About</Link>
            <Link href="/#service-area">Service area</Link>
            <Link href="/quote">Request a quote</Link>
          </nav>
          <Link className="nav-cta" href="/#request-form" data-cta="primary">
            Request a quote <Arrow />
          </Link>
          <nav className="header-contact" aria-label="Call, text or chat">
            <a href={PUBLIC_PHONE_TEL} aria-label={`Call ${PUBLIC_PHONE_DISPLAY}`}>
              {imageHero ? <><ContactIcon kind="call" /><span className="visually-hidden">Call</span></> : "Call"}
            </a>
            <OpenChatButton className="header-chat">{imageHero ? <><ContactIcon kind="chat" /><span className="visually-hidden">Chat</span></> : "Chat"}</OpenChatButton>
            <a href={PUBLIC_PHONE_SMS} aria-label={`Text ${PUBLIC_PHONE_DISPLAY}`}>
              {imageHero ? <><ContactIcon kind="text" /><span className="visually-hidden">Text</span></> : "Text"}
            </a>
          </nav>
          <button
            ref={menuButtonRef}
            className={`menu-button ${menuOpen ? "menu-button-open" : ""}`}
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <div
        id="mobile-menu"
        ref={menuRef}
        className={`mobile-menu ${menuOpen ? "mobile-menu-open" : ""}`}
        role="dialog"
        aria-modal={menuOpen || undefined}
        aria-label="Site menu"
        aria-hidden={!menuOpen}
      >
        <div className="mobile-menu-inner">
          <p>Explore P5 Home Co</p>
          <nav aria-label="Mobile navigation">
            <Link href="/#request-form" onClick={() => setMenuOpen(false)}>
              Request a quote <Arrow />
            </Link>
            <Link href="/#companies" onClick={() => setMenuOpen(false)}>
              Our companies <Arrow />
            </Link>
            <Link href="/#p5-standard" onClick={() => setMenuOpen(false)}>
              The P5 standard <Arrow />
            </Link>
            <Link href="/about" onClick={() => setMenuOpen(false)}>
              About P5 <Arrow />
            </Link>
            <Link href="/#service-area" onClick={() => setMenuOpen(false)}>
              Service area <Arrow />
            </Link>
          </nav>
          <OpenChatButton className="button button-light" location="mobile_menu" onOpen={() => setMenuOpen(false)}>
            Chat
          </OpenChatButton>
          <a className="button button-light" href={PUBLIC_PHONE_TEL}>
            Call {PUBLIC_PHONE_DISPLAY}
          </a>
          <SaveContactButton className="button button-light save-contact-button" location="mobile_menu" />
          {onOpenMatcher ? (
            <button
              className="button button-light"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenMatcher();
              }}
            >
              Help me choose a company <Arrow />
            </button>
          ) : null}
        </div>
      </div>

      {/* Skip-link target: the first thing after the header and menu. */}
      <span id="main-content" className="main-content-target" tabIndex={-1} />
      {children}

      <footer className="site-footer">
        <div className="content-shell">
          <div className="footer-main">
            <div className="footer-brand">
              <FooterWordmark />
              <p>
                The parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise
                Handyman Co. Boise ADU Co projects currently run through Boise Construction Co; its site is coming.
              </p>
              <a
                className="footer-phone"
                href="tel:+12084771169"
                onClick={() => track("phone_click", { location: "footer" })}
              >
                (208) 477-1169
              </a>
              <a className="footer-email" href="mailto:hello@p5homeco.com">
                hello@p5homeco.com
              </a>
              <SaveContactButton className="footer-save-contact" location="footer" />
            </div>
            <div className="footer-links">
              <div>
                <h3>Our companies</h3>
                <External href="https://boiseconstruction.co">Boise Construction Co</External>
                <External href="https://boiseremodeling.co">Boise Remodeling Co</External>
                <External href="https://boisecabinet.co">Boise Cabinet Co</External>
                <External href="https://boisehandyman.co">Boise Handyman Co</External>
                <a href="https://boiseconstruction.co">
                  Boise ADU Co <small>Through Construction</small>
                </a>
              </div>
              <div>
                <h3>Explore</h3>
                <Link href="/about">About P5 Home Co</Link>
                <Link href="/#p5-standard">The P5 standard</Link>
                <Link href="/#service-area">Service area</Link>
                <Link href="/#faq">Common questions</Link>
                <Link href="/quote">Request a quote</Link>
                <Link href="/sitemap">Site map</Link>
              </div>
            </div>
          </div>
          <PublicIdentity />
          <div className="footer-bottom">
            <span>© 2026 P5 Home Co. All rights reserved.</span>
            <span>Boise and the Treasure Valley, Idaho</span>
          </div>
        </div>
      </footer>
    </>
  );
}
