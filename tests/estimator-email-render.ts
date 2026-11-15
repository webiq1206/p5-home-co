/**
 * Synthetic guided-estimate emails for tests and screenshots.
 * Amounts come from priceEstimate. Nothing is sent.
 */
import { customerConfirmation, teamReport, type TeamReportLinks, type UploadLink } from "../app/lib/estimator/emails.ts";
import { customerEstimate, internalReport, priceEstimate, type PricedEstimate } from "../app/lib/estimator/price.ts";
import type { GuidedRow } from "../app/lib/estimator/store.ts";
import type { Answers, BrandId, Tier } from "../app/lib/estimator/types.ts";
import type { Message } from "../app/lib/notifications/render.ts";

export const EMAIL_NOW = new Date("2026-11-15T09:44:00Z");

export type EmailFixture = {
  id: string;
  brand: BrandId;
  project: string;
  tier: Tier;
  answers: Answers;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  uploads: UploadLink[];
  withhold: boolean;
  qboUrl: string | null;
  leadUrl: string | null;
};

export const EMAIL_FIXTURES: EmailFixture[] = [
  {
    id: "p5-handyman-small",
    brand: "p5",
    project: "handyman",
    tier: "mid",
    answers: { tasks: { faucet: 1 } },
    firstName: "[QA] Ada",
    lastName: "Small",
    email: "ada.small@example.com",
    phone: "(208) 555-0101",
    uploads: [],
    withhold: false,
    qboUrl: "https://qbo.intuit.com/app/estimate?txnId=73",
    leadUrl: "https://p5homeco.com/admin/lead/41",
  },
  {
    id: "p5-kitchen-mid",
    brand: "p5",
    project: "kitchen-remodel",
    tier: "mid",
    answers: { size: "medium" },
    firstName: "[QA] Bea",
    lastName: "Kitchen",
    email: "bea.kitchen@example.com",
    phone: "",
    uploads: [],
    withhold: false,
    qboUrl: null,
    leadUrl: null,
  },
  {
    id: "p5-addition-plans",
    brand: "p5",
    project: "addition",
    tier: "high",
    answers: { type: "room", sqft: 600 },
    firstName: "[QA] Cam",
    lastName: "Addition",
    email: "cam.addition@example.com",
    phone: "(208) 555-0103",
    uploads: [],
    withhold: false,
    qboUrl: null,
    leadUrl: "https://p5homeco.com/admin/lead/43",
  },
  {
    id: "p5-basement-uploads",
    brand: "p5",
    project: "basement-finish",
    tier: "mid",
    answers: { sqft: 800 },
    firstName: "[QA] Dee",
    lastName: "Basement",
    email: "dee.basement@example.com",
    phone: "(208) 555-0104",
    uploads: [
      { name: "basement-plan.pdf", url: "https://p5homeco.com/admin/p5-estimators" },
      { name: "photo.jpg", url: "https://p5homeco.com/admin/p5-estimators" },
    ],
    withhold: false,
    qboUrl: null,
    leadUrl: null,
  },
  {
    id: "p5-custom-home-withheld",
    brand: "p5",
    project: "custom-home",
    tier: "high",
    answers: { sqft: 2400 },
    firstName: "[QA] <script>",
    lastName: "Home",
    email: "script.home@example.com",
    phone: "(208) 555-0105",
    uploads: [],
    withhold: true,
    qboUrl: "https://qbo.intuit.com/app/estimate",
    leadUrl: null,
  },
];

export function pricedFixture(fixture: EmailFixture): PricedEstimate {
  return priceEstimate(
    { brand: fixture.brand, project: fixture.project, tier: fixture.tier, answers: fixture.answers, address: "100 Example Ave, Boise, ID 83702", property: null },
    { now: EMAIL_NOW },
  );
}

export function rowForFixture(fixture: EmailFixture, estimate = pricedFixture(fixture)): GuidedRow & { uploads: UploadLink[] } {
  const view = customerEstimate(estimate, {
    token: "a".repeat(40),
    address: "100 Example Ave, Boise, ID 83702",
    createdAt: EMAIL_NOW,
    officialCopy: "after-review",
  });
  if (fixture.withhold) view.range = null;
  return {
    id: 41,
    token: view.token,
    brand: estimate.brand,
    client_key: "fixture",
    project: estimate.project,
    tier: estimate.tier,
    answers: estimate.answers,
    address: view.address,
    property: null,
    first_name: fixture.firstName,
    last_name: fixture.lastName,
    email: fixture.email,
    phone: fixture.phone,
    marketing_consent: false,
    attribution: { utm_source: "qa" },
    elapsed_ms: 1000,
    estimate_class: estimate.estimateClass,
    total: String(estimate.pricing.totals.basePrice),
    total_cost: estimate.pricing.totals.baseCost == null ? null : String(estimate.pricing.totals.baseCost),
    margin: estimate.pricing.totals.margin == null ? null : String(estimate.pricing.totals.margin),
    price_withheld: fixture.withhold,
    review: estimate.review,
    customer_view: view,
    internal_report: internalReport(estimate),
    rules_version: estimate.versions.rules,
    cost_book_version: estimate.versions.costBook,
    scope_project_id: 7,
    scope_version_id: 1,
    lead_deal_id: fixture.leadUrl ? 41 : null,
    delivery: {},
    created_at: EMAIL_NOW,
    uploads: fixture.uploads,
  };
}

export function linksFor(fixture: EmailFixture): TeamReportLinks {
  return {
    scopeUrl: "https://p5homeco.com/scopes/7",
    qboUrl: fixture.qboUrl,
    estimateNumber: "P5-AAAAAAAA",
    status: fixture.qboUrl && fixture.qboUrl.includes("txnId=") ? "Created in QuickBooks, not sent" : "Waiting for team review",
    customerViewUrl: "https://p5homeco.com/estimator/e/abc",
    leadUrl: fixture.leadUrl,
    hubspotContactUrl: fixture.leadUrl ? "https://app-na2.hubspot.com/contacts/247066159/record/0-1/123" : null,
    hubspotDealUrl: fixture.leadUrl ? "https://app-na2.hubspot.com/contacts/247066159/record/0-3/456" : null,
    uploads: fixture.uploads,
  };
}

export function renderFixture(fixture: EmailFixture): { estimate: PricedEstimate; admin: Message; customer: Message } {
  const estimate = pricedFixture(fixture);
  const row = rowForFixture(fixture, estimate);
  return {
    estimate,
    admin: teamReport(row, linksFor(fixture)),
    customer: customerConfirmation(row, "https://p5homeco.com/estimator/e/abc"),
  };
}
