/**
 * Family chrome contract. SHARED FILE: synced byte-identical to every family
 * site and hash-checked by scripts/verify-family-chrome.mjs. Never edit it in
 * one brand repository only. Every brand difference belongs in that site's own
 * lib/familyBrand.ts, which exports FAMILY_BRAND typed as FamilyBrand.
 */

/**
 * A route pattern. "/" and "/about" match exactly; "/services/*" matches the
 * section and everything under it; "/re-10*" matches any path with that prefix.
 */
export type RoutePattern = string;

export interface FamilyLink {
  label: string;
  href: string;
  /** Extra rel tokens for this link, for example "nofollow". */
  rel?: string;
}

export interface FamilyLinkGroup {
  /** A column label. Rendered as text, never as a heading. */
  title: string;
  links: FamilyLink[];
}

export interface FamilyLockup {
  src: string;
  width: number;
  height: number;
}

export interface FamilyCompany {
  name: string;
  href: string;
}

export interface FamilyBrand {
  /** Short id, for example "p5" or "construction". */
  id: string;
  name: string;
  /** Canonical origin, no trailing slash. */
  domain: string;
  /** Accessible name for the lockup image, for example "Brand Co, a Parent Company". */
  lockupLabel: string;
  /** Lockups by the ground they sit on: onDark is the light artwork, onLight the dark artwork. */
  lockup: { onDark: FamilyLockup; onLight: FamilyLockup };
  /** The one brand accent (CTA bar, headline second line) and its AA text-safe ink on light grounds. */
  accent: string;
  accentInk: string;
  header: {
    /** Routes whose first section is a photograph: the header renders dark over them. Everything else is light. */
    darkOn: RoutePattern[];
    /** Width at which the full navigation replaces Call + menu, and the bottom bar retires. */
    desktopFrom: 1024 | 1180;
    /** Compact controls beside the menu button on phones and tablets, in order. */
    phoneActions: Array<'call' | 'text' | 'chat'>;
  };
  nav: FamilyLink[];
  cta: { label: string; href: string };
  phone: { display: string; telHref: string; smsHref: string };
  chat: { enabled: boolean; label: string; /** window event the site's chat listens for */ openEvent: string };
  bar: {
    /** True: the bar shows over the hero from the first screen. False: it waits until the hero's own CTA leaves the viewport. */
    showOverHero: boolean;
    callLabel: string;
    /** Routes where a task (a wizard) owns the bottom of the screen, so the bar never renders. */
    hiddenOn: RoutePattern[];
    /** document.body data flags (camelCase dataset keys) that, when "true", mean an interface needs the space. */
    yieldToBodyFlags: string[];
  };
  analytics: {
    /** gtag event for the header and menu primary CTA. */
    ctaEvent: string;
    /** gtag event for the bottom bar primary CTA. */
    barCtaEvent: string;
  };
  /** vCard download for "Save contact"; empty string hides it. */
  saveContactHref: string;
  email: string;
  /** One line under the lockup in the footer. */
  tagline: string;
  /** The parent-company line, for example "A Parent Co company". */
  parentLine: string;
  footer: {
    groups: FamilyLinkGroup[];
    areas: { label: string; href: string; links: FamilyLink[] };
    legal: FamilyLink[];
    /** Legal disclosure, for example a DBA line, with one optional link. */
    disclosure: { before: string; linkLabel: string; href: string; after: string };
    copyrightName: string;
  };
  /** Every family company, in display order. The current brand is shown unlinked. */
  family: { label: string; companies: FamilyCompany[] };
  /** Name, address and service-area line exactly as the business publishes it. */
  nap: { line: string };
  hours: string;
  registration: { text: string; href: string; title: string; ariaLabel: string; rel: string };
  /** Parent company Facebook page; an empty href renders nothing. */
  parentFacebook: { href: string; label: string };
}

function normalise(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/** True when the pathname matches any of the patterns (see RoutePattern). */
export function matchesRoute(pathname: string | null | undefined, patterns: RoutePattern[]): boolean {
  if (!pathname) return false;
  const path = normalise(pathname);
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      return path === base || path.startsWith(base + '/');
    }
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    return path === normalise(pattern);
  });
}

/** True for links that leave the site. */
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** True when a navigation href is the current page or a section the current page sits in. */
export function isActiveHref(pathname: string | null | undefined, href: string): boolean {
  if (!pathname || !href.startsWith('/') || href.includes('#')) return false;
  const path = normalise(pathname);
  if (href === '/') return path === '/';
  return path === href || path.startsWith(href + '/');
}
