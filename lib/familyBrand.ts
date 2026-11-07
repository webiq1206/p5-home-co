/**
 * P5 Home Co configuration for the shared family chrome.
 *
 * BRAND-OWNED: this is the one file where this site differs from its siblings.
 * The components in components/family/ and the styles in styles/family-*.css are
 * synced byte-identical across the P5 Home Co family (lib/family/manifest.json);
 * they read everything brand-specific from FAMILY_BRAND below.
 *
 * Kept free of heavy imports on purpose: the header and bottom bar are client
 * components, so whatever this module imports ships to every page.
 */
import type { FamilyBrand } from '@/lib/family/types';
import { BUSINESS_HOURS_LABEL } from '@/lib/businessHours';
import {
  ADU_QUOTE_URL,
  IDAHO_DOPL_LICENSE_SEARCH,
  P5_FACEBOOK_URL,
  P5_GOOGLE_BUSINESS_PROFILE_URL,
  PUBLIC_EMAIL,
  PUBLIC_PHONE_DISPLAY,
  PUBLIC_PHONE_SMS,
  PUBLIC_PHONE_TEL,
  PUBLIC_REGISTRATION,
} from '@/app/publicIdentity';

/** The P5 lockup artwork is 251.24 x 50; the header and footer cap its height. */
const LOCKUP = { width: 251, height: 50 };

export const FAMILY_BRAND: FamilyBrand = {
  id: 'p5',
  name: 'P5 Home Co',
  domain: 'https://p5homeco.com',
  lockupLabel: 'P5 Home Co, The Home Company',
  lockup: {
    onDark: { src: '/brands/p5-home-co-lockup-light.svg', ...LOCKUP },
    onLight: { src: '/brands/p5-home-co-lockup-dark.svg', ...LOCKUP },
  },
  // Tan retains the existing control details; heading emphasis uses the exact logo bronze role.
  accent: '#ceb391',
  accentInk: '#705a45',
  header: {
    // The homepage opens on the full-bleed landscape photograph; every other page opens on paper.
    darkOn: ['/'],
    // Four navigation items and the CTA fit beside the lockup at 1024, and the bar retires there,
    // matching the 1023px limit the P5 bar has always used.
    desktopFrom: 1024,
    // The P5 header has always offered Call, Chat and Text beside the menu on phones.
    phoneActions: ['call', 'chat', 'text'],
  },
  nav: [
    { label: 'Our companies', href: '/#companies' },
    { label: 'The P5 standard', href: '/#p5-standard' },
    { label: 'About', href: '/about' },
    { label: 'Service area', href: '/#service-area' },
  ],
  // One label, one destination: the quote page.
  cta: { label: 'Request a quote', href: '/quote' },
  phone: { display: PUBLIC_PHONE_DISPLAY, telHref: PUBLIC_PHONE_TEL, smsHref: PUBLIC_PHONE_SMS },
  // components/SiteChat.tsx opens on this window event.
  chat: { enabled: true, label: 'Chat', openEvent: 'p5:chat-open', hiddenOn: ['/admin*', '/portal*'] },
  bar: {
    // Approved check (scripts/verify-p5-mobile-seo.mjs): hidden over the hero, shown once it has passed.
    showOverHero: false,
    callLabel: 'Call',
    // The quote wizard and the estimators own the bottom of the screen; private areas have no bar.
    hiddenOn: ['/quote/*', '/estimate/*', '/admin/*', '/api/*', '/portal/*', '/login*', '/sitemap', '/legal/*'],
    yieldToBodyFlags: ['p5EstimatorActive', 'p5ChatOpen', 'p5MatcherOpen'],
    // The same check requires the bar gone within 150ms of returning to the hero, as the P5 bar
    // always was: it leaves at once instead of after the 300ms slide-out, and still slides in.
    hideInstantly: true,
  },
  // The event names P5 already reports for a quote click.
  analytics: { ctaEvent: 'quote_click', barCtaEvent: 'quote_click' },
  // BUSINESS_VCARD_PATH in lib/vcard.ts (that module pulls in more than the chrome needs).
  saveContactHref: '/contact.vcf',
  email: PUBLIC_EMAIL,
  tagline: 'The parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co.',
  parentLine: 'Boise and the Treasure Valley, Idaho',
  footer: {
    groups: [
      {
        title: 'Explore',
        links: [
          { label: 'About P5 Home Co', href: '/about' },
          { label: 'The P5 standard', href: '/#p5-standard' },
          { label: 'Service area', href: '/#service-area' },
          { label: 'Common questions', href: '/#faq' },
        ],
      },
      {
        title: 'Start a project',
        links: [
          { label: 'Request a quote', href: '/quote' },
          { label: 'Choose a company', href: '/#companies' },
        ],
      },
    ],
    areas: { label: 'Service area: Ada and Canyon counties', href: '/#service-area', links: [] },
    legal: [
      { label: 'Site map', href: '/sitemap' },
      { label: 'Privacy policy', href: '/legal/privacy' },
      { label: 'Terms of service', href: '/legal/terms' },
    ],
    // The approved Boise ADU Co line (ADU_D3_LINE). The name links to the P5 quote path.
    disclosure: {
      before: '',
      linkLabel: 'Boise ADU Co',
      href: ADU_QUOTE_URL,
      after: ' projects run through Boise Construction Co.',
    },
    copyrightName: 'P5 Home Co',
  },
  // Boise ADU Co is left out until its own site exists; its projects run through Boise Construction Co.
  family: {
    label: 'The P5 Home Co family',
    companies: [
      { name: 'P5 Home Co', href: 'https://p5homeco.com' },
      { name: 'Boise Construction Co', href: 'https://boiseconstruction.co' },
      { name: 'Boise Remodeling Co', href: 'https://boiseremodeling.co' },
      { name: 'Boise Handyman Co', href: 'https://boisehandyman.co' },
      { name: 'Boise Cabinet Co', href: 'https://boisecabinet.co' },
    ],
  },
  // Contact details and hours are rendered separately by the shared footer.
  nap: { line: 'Serving Boise and the Treasure Valley' },
  hours: BUSINESS_HOURS_LABEL,
  registration: {
    text: PUBLIC_REGISTRATION,
    href: IDAHO_DOPL_LICENSE_SEARCH,
    title: 'Idaho contractor registration',
    ariaLabel: 'Idaho contractor registration 8381215, opens in a new tab',
    rel: 'noopener noreferrer',
  },
  parentFacebook: { href: P5_FACEBOOK_URL, label: 'P5 Home Co on Facebook' },
  // P5 Home Co's one Google Business Profile (owner call A, 1 November), beside its Facebook page.
  parentGoogle: { href: P5_GOOGLE_BUSINESS_PROFILE_URL, label: 'P5 Home Co on Google' },
};
