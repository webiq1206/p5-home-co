/**
 * Administrator-configurable settings.
 *
 * Nothing the rules engine depends on is hardcoded at a call site. Defaults
 * live here; overrides live in the `setting` table and win. Anything an
 * administrator should be able to change belongs in this shape.
 */

import { citiesServed } from "../../site.ts";
import { query } from "../db.ts";
import { DEFAULT_ESCALATION, P5_CALENDAR, type BusinessCalendar, type EscalationThresholds } from "./time.ts";
import { BRANDS, type Brand } from "./types.ts";

export type AfterHoursBehavior = "queue_only" | "queue_and_acknowledge";

/**
 * A verified Gmail "Send mail as" identity, inventoried from the
 * hello@p5homeco.com Workspace account rather than assumed.
 */
export type BrandSendAs = {
  address: string;
  displayName: string;
  /** Name of the Gmail signature bound to this brand. */
  signature: string;
  /** Date the alias was confirmed present and verified in Gmail. */
  verifiedOn: string;
};

export type LeadManagerSettings = {
  business: {
    name: string;
    phone: string;
    website: string;
    category: string;
  };
  calendar: BusinessCalendar;
  escalation: EscalationThresholds;
  /** Business minutes allowed for the first human response attempt. */
  firstResponseTargetMinutes: number;
  /** Business hours a deal may sit with no activity before it is stale. */
  staleDealAfterHours: number;
  /** Minutes an alert stays quiet after notifying, to stop repeat pings. */
  alertCooldownMinutes: number;
  afterHoursBehavior: AfterHoursBehavior;
  /**
   * Service areas. Seeded from the approved website list, which is the
   * authorized source for coverage claims. The Google Business Profile
   * appears to list nine areas, so this needs reconciling with the owner
   * before it is entered into HubSpot.
   */
  serviceAreas: string[];
  serviceAreasVerified: boolean;
  brands: readonly Brand[];
  /**
   * Verified send-from identity per brand.
   *
   * A brand missing from this map has no verified Gmail alias, and a send for
   * it must be blocked with a clear administrator action rather than falling
   * back to another brand's address.
   */
  brandEmailAliases: Partial<Record<Brand, BrandSendAs>>;
  lostReasons: string[];
  projectTypes: string[];
  /** Client-facing automation stays off until explicitly approved. */
  automation: {
    autoAcknowledgeEnabled: boolean;
    clientFacingMessagesEnabled: boolean;
    testMode: boolean;
  };
  featureFlags: {
    handoffIntegrationEnabled: boolean;
    quickBooksIntegrationEnabled: boolean;
    hubspotIntegrationEnabled: boolean;
    gmailIntegrationEnabled: boolean;
    facebookIntegrationEnabled: boolean;
  };
};

export const DEFAULT_SETTINGS: LeadManagerSettings = {
  business: {
    name: "P5 Home Co",
    phone: "+12084771169",
    website: "https://p5homeco.com/",
    category: "General Contractor",
  },
  calendar: P5_CALENDAR,
  escalation: DEFAULT_ESCALATION,
  firstResponseTargetMinutes: 5,
  staleDealAfterHours: 72,
  alertCooldownMinutes: 30,
  afterHoursBehavior: "queue_only",
  serviceAreas: [...citiesServed],
  serviceAreasVerified: false,
  brands: BRANDS,
  // Verified in the hello@p5homeco.com Gmail account on 2026-08-21. Display
  // names and trailing periods are reproduced exactly as configured.
  //
  // Boise Construction Co and Boise Handyman Co are deliberately absent. Both
  // have a signature prepared in Gmail, but neither has a verified send-from
  // alias, so there is no address to send as. They must stay absent until the
  // aliases are added and verified; a missing entry blocks the send, which is
  // the safe failure. Guessing an address here would mail clients from an
  // unverified sender and risk it being rejected or spoofed.
  brandEmailAliases: {
    "P5 Home Co": {
      address: "hello@p5homeco.com",
      displayName: "Client Services",
      signature: "P5 Home Co",
      verifiedOn: "2026-08-21",
    },
    "Boise ADU Co": {
      address: "hello@boiseadu.co",
      displayName: "Boise ADU Co.",
      signature: "Boise ADU Co.",
      verifiedOn: "2026-08-21",
    },
    "Boise Cabinet Co": {
      address: "hello@boisecabinet.co",
      displayName: "Boise Cabinet Co.",
      signature: "Boise Cabinet Co.",
      verifiedOn: "2026-08-21",
    },
    "Boise Remodeling Co": {
      address: "hello@boiseremodeling.co",
      displayName: "Boise Remodeling Co.",
      signature: "Boise Remodeling Co.",
      verifiedOn: "2026-08-21",
    },
  },
  lostReasons: [
    "Price",
    "Timeline",
    "Chose another contractor",
    "Scope not a fit",
    "Outside service area",
    "Unresponsive",
    "Project cancelled",
    "Other",
  ],
  projectTypes: [
    "Custom home",
    "Semi-custom home",
    "Build on land I own",
    "Home plans or lot evaluation",
    "Kitchen remodel",
    "Bathroom remodel",
    "Whole-home remodel",
    "Addition, ADU, or basement",
    "Detached ADU",
    "Garage conversion",
    "Basement or interior unit",
    "Feasibility and permits",
    "Drywall or trim repair",
    "Mounting or installation",
    "Deck or exterior repair",
    "A multi-item home list",
    "Kitchen cabinets",
    "Bathroom vanity",
    "Built-ins or storage",
    "Whole-home cabinetry",
  ],
  automation: {
    autoAcknowledgeEnabled: false,
    clientFacingMessagesEnabled: false,
    testMode: true,
  },
  featureFlags: {
    // Both deferred integrations default to false and must stay false. While
    // off, no request is made, no job runs, and neither can raise an alert.
    handoffIntegrationEnabled: false,
    quickBooksIntegrationEnabled: false,
    // These turn on only once their credentials are verified end to end.
    hubspotIntegrationEnabled: false,
    gmailIntegrationEnabled: false,
    facebookIntegrationEnabled: false,
  },
};

const SETTINGS_KEY = "lead_manager";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge stored overrides over defaults, one level into nested objects.
 *
 * Deliberately shallow-per-section: a partial `calendar` override should not
 * drop the timezone, but an array like `serviceAreas` must be replaced whole
 * rather than merged element-wise.
 */
export function mergeSettings(base: LeadManagerSettings, override: unknown): LeadManagerSettings {
  if (!isObject(override)) return base;

  const merged: Json = { ...(base as unknown as Json) };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isObject(value) && isObject(current)) {
      merged[key] = { ...current, ...value };
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as LeadManagerSettings;
}

/**
 * Load settings, falling back to defaults when the database is unavailable.
 *
 * The rules engine must still be able to reason with a known-good calendar if
 * the settings row is missing, rather than refusing to evaluate deadlines.
 */
export async function loadSettings(): Promise<LeadManagerSettings> {
  try {
    const rows = await query<{ value: unknown }>(
      "SELECT value FROM setting WHERE key = $1",
      [SETTINGS_KEY],
    );
    if (!rows.length) return DEFAULT_SETTINGS;
    return mergeSettings(DEFAULT_SETTINGS, rows[0].value);
  } catch (error) {
    console.error("[settings] falling back to defaults:", (error as Error).message);
    return DEFAULT_SETTINGS;
  }
}

/** Persist a partial settings override, recording who changed it. */
export async function saveSettings(
  partial: Partial<LeadManagerSettings>,
  userId: number | null,
): Promise<LeadManagerSettings> {
  const current = await loadSettings();
  const next = mergeSettings(current, partial);

  await query(
    `INSERT INTO setting (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(next), userId],
  );

  return next;
}

/**
 * Resolve the verified send-from identity for a brand.
 *
 * Returns null when the brand has no verified alias. Callers must treat null
 * as a hard stop and surface an administrator action: sending a client an
 * email from the wrong company is worse than not sending it, and an
 * unverified sender is likely to be rejected or treated as spoofed.
 */
export function sendAsForBrand(
  settings: LeadManagerSettings,
  brand: Brand,
): BrandSendAs | null {
  return settings.brandEmailAliases[brand] ?? null;
}

/** Brands that cannot currently send, for the integration-health screen. */
export function brandsWithoutSendAs(settings: LeadManagerSettings): Brand[] {
  return settings.brands.filter((brand) => !settings.brandEmailAliases[brand]);
}
