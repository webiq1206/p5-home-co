/**
 * P5 Home Co Google Ads conversions.
 *
 * The shared estimator calls trackGoogleAdsLeadConversion after a successful
 * submit. Brand sites keep their own copy of this module and ignore any
 * contact fields they have not opted in to read. This file is not part of the
 * shared engine.
 *
 * The AW-18354188204 tag is loaded by app/layout.tsx through
 * googleTagBootstrap, which already applies the hostname, webdriver,
 * qa-saved, and p5_analytics_disabled gate. Do not add a second tag.
 */

export const ESTIMATOR_CONVERSION_SEND_TO = "AW-18354188204/cEzmCPOagKAdEKzf-q9E";

export type EnhancedConversionContact = {
  name?: string;
  email?: string;
  phone?: string;
  /** Structured ZIP only. Street, city, and free text are never read. */
  postalCode?: string;
};

export type EnhancedAddress = {
  first_name?: string;
  last_name?: string;
  postal_code?: string;
  country: "US";
};

export type EnhancedUserData = {
  email?: string;
  phone_number?: string;
  address?: EnhancedAddress;
};

export type AdsLeadContext = EnhancedConversionContact & {
  service?: string;
  projectType?: string;
  /** False skips the p5 conversion. Brands that do not read this field are unchanged. */
  accepted?: boolean;
  transactionId?: string;
};

const sentEstimatorIds = new Set<string>();

/** US ZIP or ZIP+4. Anything else, including a street, is dropped. */
function postalCode(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return /^\d{5}(?:-\d{4})?$/.test(text) ? text : undefined;
}

/**
 * Fields Google enhanced conversions may receive. Only email, a 10-digit
 * phone, and address name/ZIP are copied. Email is trimmed and lowercased.
 * Phone is omitted unless it has exactly 10 digits, then sent as +1XXXXXXXXXX.
 */
export function enhancedConversionUserData(contact?: EnhancedConversionContact | null): EnhancedUserData | null {
  if (!contact) return null;
  const user: EnhancedUserData = {};
  const email = String(contact.email ?? "").trim().toLowerCase();
  if (email) user.email = email;
  const digits = String(contact.phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) user.phone_number = `+1${digits}`;

  const address: { first_name?: string; last_name?: string; postal_code?: string; country?: "US" } = {};
  const parts = String(contact.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length) {
    address.first_name = parts[0];
    if (parts.length > 1) address.last_name = parts.slice(1).join(" ");
  }
  const postal = postalCode(contact.postalCode);
  if (postal) address.postal_code = postal;
  if (address.first_name || address.last_name || address.postal_code) {
    address.country = "US";
    user.address = address as EnhancedAddress;
  }
  return user.email || user.phone_number || user.address ? user : null;
}

type GtagWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[][];
};

/** Queue a gtag command. Installs the same dataLayer stub the quote path uses when the tag is not loaded yet. */
export function queueGtag(command: string, name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as GtagWindow;
  if (typeof w.gtag !== "function") {
    w.dataLayer = w.dataLayer || [];
    w.gtag = (...args: unknown[]) => {
      w.dataLayer!.push(args);
    };
  }
  w.gtag(command, name, params);
}

/**
 * P5 estimator finish. Fires AW-18354188204/cEzmCPOagKAdEKzf-q9E once per
 * transaction id after user_data, and only for an estimator: success.
 * Intake keys and accepted:false return before any gtag call.
 */
export function trackGoogleAdsLeadConversion(context: AdsLeadContext = {}, dedupeKey?: string): boolean {
  try {
    if (context.accepted === false) return false;
    if (typeof dedupeKey !== "string" || !dedupeKey.startsWith("estimator:")) return false;
    const transactionId = String(context.transactionId ?? "").trim() || dedupeKey.slice("estimator:".length).trim();
    if (!transactionId) return false;
    if (sentEstimatorIds.has(transactionId)) return false;
    if (typeof window === "undefined") return false;
    const userData = enhancedConversionUserData(context);
    if (userData) queueGtag("set", "user_data", userData as unknown as Record<string, unknown>);
    queueGtag("event", "conversion", {
      send_to: ESTIMATOR_CONVERSION_SEND_TO,
      transaction_id: transactionId,
    });
    sentEstimatorIds.add(transactionId);
    return true;
  } catch {
    return false;
  }
}
