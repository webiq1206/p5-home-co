/**
 * Analytics for the family chrome. SHARED FILE (lib/family/manifest.json).
 * Sends a GA4 event when gtag is present and never throws: a missing or broken
 * tag must not stop a visitor reaching the quote form. Call, text and email
 * links are tracked by each site's delegated listener, not here.
 */
type Gtag = (command: 'event', name: string, params: Record<string, unknown>) => void;

export function trackFamilyEvent(name: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !name) return;
  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === 'function') gtag('event', name, params);
  } catch {
    // Analytics never blocks navigation.
  }
}
