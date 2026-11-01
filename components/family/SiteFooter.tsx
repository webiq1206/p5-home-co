/**
 * Family site footer. SHARED FILE (lib/family/manifest.json).
 *
 * Brand column (lockup, parent line, one line, phone in the display face, text,
 * email, Save contact), then the brand's link groups, the service-area row, the
 * family row naming every company on every site, and the legal row: NAP with
 * hours, the registration link, copyright, disclosure and legal links. Group
 * labels are text, not headings, so the footer stays out of the page outline.
 * Family links carry rel="noopener" without noreferrer so referral data reaches
 * the sibling sites.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';
import { isExternal, type FamilyLink } from '@/lib/family/types';
import { brandStyle } from './brandStyle';
import { ContactCardIcon } from './Icons';

function FooterAnchor({ link, className }: { link: FamilyLink; className?: string }) {
  if (isExternal(link.href)) {
    return (
      <a href={link.href} className={className} rel={['noopener', link.rel].filter(Boolean).join(' ')}>
        {link.label}
      </a>
    );
  }
  if (link.rel) {
    // Plain anchor so the rel survives exactly as written (for example nofollow on a login link).
    return (
      <a href={link.href} className={className} rel={link.rel}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

/** Read once per server start or build, not on every render. */
const YEAR = new Date().getFullYear();

function sameSite(href: string, domain: string): boolean {
  return href.replace(/\/$/, '') === domain.replace(/\/$/, '');
}

export interface SiteFooterProps {
  /** Pages that must not state the registration line hide it. */
  hideRegistration?: boolean;
  /** Optional extra content for the brand column, rendered after the contact list. */
  brandExtra?: ReactNode;
}

export function SiteFooter({ hideRegistration = false, brandExtra }: SiteFooterProps) {
  const brand = FAMILY_BRAND;
  const { footer } = brand;

  return (
    <footer className="fam-footer" data-family-footer="" style={brandStyle()}>
      <div className="fam-container">
        <div className="fam-footer-top">
          <div className="fam-footer-brand">
            <Link href="/" className="fam-footer-logo" aria-label={`${brand.lockupLabel}, home`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- vector lockup at its own aspect ratio */}
              <img src={brand.lockup.onDark.src} width={brand.lockup.onDark.width} height={brand.lockup.onDark.height} alt="" loading="lazy" />
            </Link>
            <p className="fam-footer-parent">{brand.parentLine}</p>
            <p className="fam-footer-tagline">{brand.tagline}</p>
            <a href={brand.phone.telHref} className="fam-footer-phone" data-testid="link-footer-phone">
              {brand.phone.display}
            </a>
            <ul className="fam-footer-contact">
              <li>
                <a href={brand.phone.smsHref} data-testid="link-footer-text">
                  Text {brand.phone.display}
                </a>
              </li>
              <li>
                <a href={`mailto:${brand.email}`} data-testid="link-footer-email">
                  {brand.email}
                </a>
              </li>
              {brand.saveContactHref ? (
                <li>
                  <a href={brand.saveContactHref} className="fam-footer-save" data-testid="link-save-contact">
                    <ContactCardIcon size={18} />
                    Save our contact
                  </a>
                </li>
              ) : null}
              {brand.parentFacebook.href ? (
                <li>
                  <a href={brand.parentFacebook.href} rel="noopener" target="_blank" data-testid="link-footer-facebook">
                    {brand.parentFacebook.label}
                  </a>
                </li>
              ) : null}
            </ul>
            {brandExtra}
          </div>

          {footer.groups.map((group) => (
            <div className="fam-footer-group" key={group.title}>
              <p className="fam-footer-label">{group.title}</p>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="fam-footer-row fam-footer-areas">
          <Link href={footer.areas.href} className="fam-footer-label fam-footer-row-label">
            {footer.areas.label}
          </Link>
          <ul>
            {footer.areas.links.map((link) => (
              <li key={link.href}>
                <FooterAnchor link={link} />
              </li>
            ))}
          </ul>
        </div>

        <div className="fam-footer-row fam-footer-family" data-family-row="">
          <p className="fam-footer-label fam-footer-row-label">{brand.family.label}</p>
          <ul>
            {brand.family.companies.map((company) =>
              sameSite(company.href, brand.domain) ? (
                <li key={company.href}>
                  <span className="fam-footer-current" aria-current="true">
                    {company.name}
                  </span>
                </li>
              ) : (
                <li key={company.href}>
                  <a href={company.href} rel="noopener">
                    {company.name}
                  </a>
                </li>
              ),
            )}
          </ul>
        </div>

        <div className="fam-footer-legal">
          <p className="fam-footer-nap">
            {brand.nap.line}. <a href={brand.phone.telHref}>{brand.phone.display}</a>. {brand.hours}
          </p>
          {hideRegistration ? null : (
            <p>
              <a
                href={brand.registration.href}
                target="_blank"
                rel={brand.registration.rel}
                title={brand.registration.title}
                aria-label={brand.registration.ariaLabel}
                data-testid="registration-line"
              >
                {brand.registration.text}
              </a>
            </p>
          )}
          <div className="fam-footer-legal-bottom">
            <p>
              &copy; {YEAR} {footer.copyrightName}. All rights reserved. {footer.disclosure.before}
              <a href={footer.disclosure.href} rel="noopener">
                {footer.disclosure.linkLabel}
              </a>
              {footer.disclosure.after}
            </p>
            <ul className="fam-footer-legal-links">
              {footer.legal.map((link) => (
                <li key={link.href}>
                  <FooterAnchor link={link} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
