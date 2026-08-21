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
   * Verified send-from address per brand. Empty until the real Google
   * Workspace configuration is inventoried; an unverified alias must block
   * the send rather than silently fall back to the wrong brand.
   */
  brandEmailAliases: Partial<Record<Brand, string>>;
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
  brandEmailAliases: {},
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
