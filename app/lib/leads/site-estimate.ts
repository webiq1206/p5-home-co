/**
 * Site estimates into QuickBooks (owner decision, 13 and 17 November 2026):
 * "when estimates are provided from the front end of any of the websites,
 * those estimates and that customer need to be created in our QuickBooks."
 *
 * The guided estimator already does this (estimator/deliver.ts). Two other
 * tools give a visitor a price and take their contact details:
 *
 *   planning-range   a brand site's request form with a planning range
 *                    attached. It arrives on the lead intake as `estimate`.
 *   document         the document estimator (lib/p5). Its submission becomes
 *                    a lead in this process (lib/p5/deliveryAdapter.ts).
 *
 * Both end here. One site estimate becomes one scope project linked to the
 * lead (`scope_project.lead_deal_id`), one QuickBooks customer (linked on the
 * same email or phone, else created) and one UNSENT QuickBooks estimate whose
 * total is the estimate's `base` to the cent. The range the customer saw
 * travels as words on the estimate's message and private note.
 *
 * QuickBooks is the accounting record, so the rules are narrow:
 *   - Customer prices only. Nothing here reads, stores or sends a cost or a
 *     margin, and no line carries one (`cost: null`).
 *   - One project and one estimate per lead and kind. A repeat, a merged
 *     Step 2 or a retry changes nothing. Different figures of the same kind
 *     revise that estimate; they never add a second one.
 *   - Only an estimate exactly as the website left it is revised. One a
 *     person has saved, sent or answered, or whose project a person has
 *     scoped, is left alone and the new figures are noted on the lead.
 *   - Nothing is made for a closed lead, and what a person deleted is not
 *     made again from the same figures.
 *   - Only an estimate is created: never an invoice, a payment or a project.
 *
 * `SITE_ESTIMATE_QBO=off` turns it off. QuickBooks unavailable: remembered on
 * the lead's audit trail (`site_estimate_pending`) and `settleSiteEstimates()`
 * retries from the watchdog, six hours apart, for a fortnight. Nothing here
 * throws into its caller.
 */
import { query, queryOne, transaction } from "../db.ts";
import { defaultPhase, isDivision } from "../scopes/divisions.ts";
import { rangeWords } from "../scopes/estimate.ts";
import { canonical, emptyScope } from "../scopes/types.ts";
import type { EstimateLine, ItemKey, PricingResult, ScopeDoc } from "../scopes/types.ts";
import { readSiteEstimate, MAX_SITE_ESTIMATE_LINES } from "./intakeContract.ts";
import type { SiteEstimate, SiteEstimateKind, SiteEstimateLine } from "./intakeContract.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "./synthetic-qa.ts";
import { BRANDS } from "./types.ts";
import type { Brand } from "./types.ts";

const NO_EMPLOYEE = null as unknown as number;
const PENDING = "site_estimate_pending";
/** `scope_version.source` and the `created` event's source for everything made here. */
export const SITE_ESTIMATE_SOURCE = "site-estimate";
/** Scope event: the SyncToken a write the website made by itself left the estimate at. */
export const WEBSITE_SYNC_EVENT = "site-estimate-synced";

export function siteEstimateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.SITE_ESTIMATE_QBO ?? "").trim().toLowerCase() !== "off";
}

// ---------------------------------------------------------------------------
// QuickBooks item for each line (owner to review)
// ---------------------------------------------------------------------------

/**
 * Which P5 QuickBooks item a site estimate line books to. A line is a
 * customer price for a whole trade or room, so it books to its brand's item,
 * unless its division is named exactly one of the names below. Only keys in
 * `P5_ITEMS` (scopes/qbo.ts) are used. Names are compared in lower case with
 * "&" and "+" read as "and".
 */
export const SITE_ESTIMATE_ITEMS: {
  brand: Record<Brand, ItemKey>;
  division: { names: string[]; item: ItemKey; cabinetItem?: ItemKey }[];
  cabinetDivision: { names: string[]; item: ItemKey }[];
} = {
  brand: {
    "P5 Home Co": "Subcontractor Work",
    "Boise Construction Co": "Subcontractor Work",
    "Boise Remodeling Co": "Subcontractor Work",
    "Boise ADU Co": "Subcontractor Work",
    "Boise Handyman Co": "Handyman Service Work",
    "Boise Cabinet Co": "Cabinet Installation",
  },
  division: [
    { names: ["permits", "permit", "permits and fees", "permit fees", "permits and inspections", "fees"], item: "Permits and Fees" },
    {
      names: ["00", "design", "planning", "plans", "plans and engineering", "engineering", "preconstruction", "pre-construction", "design and preconstruction", "design and preconstruction services", "pre-construction and fees"],
      item: "Design and Preconstruction Services",
    },
    { names: ["freight", "delivery", "freight and delivery", "shipping", "shipping and delivery"], item: "Freight and Delivery", cabinetItem: "Cabinet Freight and Delivery" },
    { names: ["equipment rental", "equipment rentals", "equipment and rentals", "rentals"], item: "Equipment and Rentals" },
  ],
  // Boise Cabinet Co only: product and installation are separate items in its books.
  cabinetDivision: [
    { names: ["cabinet product", "cabinets product only", "product", "product only"], item: "Cabinet Product" },
    { names: ["cabinet installation", "installation", "install"], item: "Cabinet Installation" },
  ],
};

const plainName = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[&+]/g, " and ").replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();

/** The QuickBooks item for one line: its division when that clearly maps, else its brand's item. */
export function siteEstimateItem(brand: Brand, division: string | null | undefined): ItemKey {
  const name = plainName(division);
  if (name) {
    const general = SITE_ESTIMATE_ITEMS.division.find((entry) => entry.names.includes(name));
    if (general) return brand === "Boise Cabinet Co" && general.cabinetItem ? general.cabinetItem : general.item;
    if (brand === "Boise Cabinet Co") {
      const cabinet = SITE_ESTIMATE_ITEMS.cabinetDivision.find((entry) => entry.names.includes(name));
      if (cabinet) return cabinet.item;
    }
  }
  return SITE_ESTIMATE_ITEMS.brand[brand];
}

/**
 * The cost book division a line is listed under on the QuickBooks estimate.
 * A heading only: it never changes an amount or an item. A trade name the
 * sites use is matched by its words; anything else goes under 90, Project
 * Assemblies (12 for Boise Cabinet Co).
 */
const DIVISION_WORDS: [RegExp, string][] = [
  [/\bpermit|\bfees?\b|\bdesign\b|\bplanning\b|\bplans?\b|engineering|pre-?construction|\badministration\b/, "00"],
  [/site requirement|general (condition|requirement)|supervision|clean-?up|disposal|pre-?occupancy|protection|mobiliz/, "01"],
  [/\bdemo(lition)?\b|mitigation|existing condition/, "02"],
  [/concrete|foundation/, "03"],
  [/masonry/, "04"],
  [/interior doors|millwork|framing|carpentry|\btrim\b/, "06"],
  [/roof|siding|insulation|envelope|exterior finish|waterproof/, "07"],
  [/window|opening|hardware|glass|\bdoors?\b/, "08"],
  [/cabinet|countertop|casework|vanit|furnishing/, "12"],
  [/drywall|paint|wallpaper|\btile\b|stone|flooring|carpet|finishes/, "09"],
  [/specialt/, "10"],
  [/appliance/, "11"],
  [/plumb/, "22"],
  [/hvac|mechanical|heating|cooling/, "23"],
  [/electric/, "26"],
  [/excavat|earthwork|site work|grading/, "31"],
  [/landscap|exterior improvement|fenc/, "32"],
  [/utilit/, "33"],
];

export function siteEstimateDivision(brand: Brand, division: string | null | undefined): string {
  const raw = (division ?? "").trim();
  if (/^\d{2}$/.test(raw) && isDivision(raw)) return raw;
  const name = plainName(raw);
  if (name) {
    const found = DIVISION_WORDS.find(([words]) => words.test(name));
    if (found) return found[1];
  }
  return brand === "Boise Cabinet Co" ? "12" : "90";
}

// ---------------------------------------------------------------------------
// The scope version: customer-priced lines, no cost
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SERVICE_BY_BRAND: Record<Brand, string> = {
  "P5 Home Co": "remodel",
  "Boise Construction Co": "new-construction",
  "Boise Remodeling Co": "remodel",
  "Boise ADU Co": "adu",
  "Boise Handyman Co": "handyman",
  "Boise Cabinet Co": "cabinet-install",
};

/** Which tool gave the price, in words. */
export function siteEstimateTool(kind: SiteEstimateKind, brand: Brand): string {
  return kind === "document" ? `Document estimator on ${brand}` : `Planning range from the ${brand} request form`;
}

const verifiedWords = (estimate: Pick<SiteEstimate, "verified">) =>
  estimate.verified ? "Figures verified by the site's server." : "Figures as sent by the visitor's browser, not verified by the site's server.";

/** The range (or the one price) the customer was shown, as words for the estimate's message and private note. */
export function siteRangeNote(estimate: Pick<SiteEstimate, "low" | "high" | "base">): string {
  if (Math.round(estimate.low) !== Math.round(estimate.high)) return rangeWords({ low: estimate.low, high: estimate.high }, estimate.base);
  return `Price given online: ${whole(estimate.low)}, one figure and not a range. The total on this estimate (${whole(estimate.base)}) is the base figure that price is built on.`;
}

/**
 * The lines QuickBooks will hold. Each is the customer's price for that line
 * and nothing else: there is no cost behind it. QuickBooks refuses a line
 * whose amount is not its quantity times its rate, so a quantity is kept only
 * when it divides the amount to the cent; otherwise the line is one lump sum
 * and the quantity is said in its description.
 */
export function siteEstimatePricing(brand: Brand, estimate: SiteEstimate): PricingResult {
  const tool = siteEstimateTool(estimate.kind, brand);
  const source: SiteEstimateLine[] = estimate.lines.length
    ? estimate.lines
    : [{ title: estimate.label ?? "Planning range", description: null, quantity: null, unit: null, amount: estimate.base, division: null }];
  const lines: EstimateLine[] = source.map((line, index) => {
    const division = siteEstimateDivision(brand, line.division ?? (estimate.lines.length ? line.title : null));
    const rate = line.quantity ? round2(line.amount / line.quantity) : 0;
    const exact = Boolean(line.quantity) && rate > 0 && round2(rate * line.quantity!) === line.amount;
    const measure = line.quantity && !exact ? ` (${line.quantity}${line.unit ? ` ${line.unit}` : ""})` : "";
    return {
      id: `site-${index + 1}`,
      taskId: `site-${index + 1}`,
      phase: defaultPhase(division),
      division,
      item: siteEstimateItem(brand, line.division ?? (estimate.lines.length ? line.title : null)),
      title: line.title,
      description: `${line.description ?? line.title}${measure}`,
      quantity: exact ? line.quantity! : 1,
      unit: exact ? line.unit ?? "EA" : "LS",
      unitCost: null,
      cost: null,
      unitPrice: exact ? rate : line.amount,
      price: line.amount,
      basis: "site-estimate",
      source: `${tool}. ${verifiedWords(estimate)}`,
      optional: false,
      allowance: false,
      notes: [],
    };
  });
  return {
    lines,
    issues: [],
    totals: {
      baseCost: null,
      basePrice: round2(lines.reduce((sum, line) => sum + line.price, 0)),
      optionalPrice: 0,
      margin: null,
      laborHours: 0,
      costGaps: { laborHours: 0, lines: lines.length },
      profit: null,
    },
    // No pricing policy was applied here: the figures are the website's.
    policy: { overheadRate: 0, profitRate: 0, contingencyRate: 0, laborRate: 0, finishTier: "mid", costBookSource: SITE_ESTIMATE_SOURCE, costBookVersion: estimate.kind },
  };
}

export function siteEstimateDoc(brand: Brand, estimate: SiteEstimate): ScopeDoc {
  return {
    ...emptyScope(),
    projectName: estimate.label,
    summary: [
      `${siteEstimateTool(estimate.kind, brand)}${estimate.label ? `: ${estimate.label}` : ""}.`,
      siteRangeNote(estimate),
      verifiedWords(estimate),
      "These are the customer prices the website showed. This project has no scope of its own yet; the itemized estimate is in QuickBooks, unsent.",
    ].join(" "),
  };
}

/** Two versions hold the same site estimate when their lines and their summary are the same. */
function sameSiteEstimate(a: { doc: ScopeDoc; pricing: PricingResult | null }, b: { doc: ScopeDoc; pricing: PricingResult }): boolean {
  const view = (v: { doc: ScopeDoc; pricing: PricingResult | null }) =>
    canonical(JSON.parse(JSON.stringify({ summary: v.doc?.summary ?? "", lines: v.pricing?.lines ?? [], total: v.pricing?.totals?.basePrice ?? null })));
  return view(a) === view(b);
}

// ---------------------------------------------------------------------------
// The document estimator's record as a site estimate
// ---------------------------------------------------------------------------

type DocumentRecord = {
  draftId?: unknown;
  revision?: unknown;
  scope?: { answers?: { service?: unknown } };
  customer?: { range?: { low?: unknown; high?: unknown } | null };
  internal?: { contractPrice?: unknown; lines?: unknown };
};

/**
 * What the document estimator priced, as a site estimate: the customer
 * amount of each line (`sellingAmount`), the contract price as the one figure
 * and the range the customer was shown. Null when the customer was shown no
 * price. Cost, contingency, overhead and profit fields are never read.
 */
export function documentSiteEstimate(record: DocumentRecord | null | undefined): SiteEstimate | null {
  const low = Number(record?.customer?.range?.low);
  const high = Number(record?.customer?.range?.high);
  const contract = Number(record?.internal?.contractPrice);
  if (![low, high, contract].every((n) => Number.isFinite(n) && n > 0)) return null;
  const base = round2(contract);
  const notes: string[] = [];
  let lines: SiteEstimateLine[] = [];
  for (const entry of Array.isArray(record?.internal?.lines) ? (record!.internal!.lines as Record<string, unknown>[]) : []) {
    const amount = round2(Number(entry?.sellingAmount));
    const description = typeof entry?.description === "string" ? entry.description.replace(/\s+/g, " ").trim() : "";
    if (!Number.isFinite(amount) || amount <= 0 || !description) continue;
    const quantity = Number(entry.quantity);
    lines.push({
      title: description.slice(0, 200),
      description: description.length > 200 ? description.slice(0, 1000) : null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      unit: typeof entry.unit === "string" && entry.unit.trim() ? entry.unit.trim().slice(0, 20) : null,
      amount,
      division: typeof entry.trade === "string" && entry.trade.trim() ? entry.trade.trim().slice(0, 80) : null,
    });
  }
  if (lines.length > MAX_SITE_ESTIMATE_LINES) {
    // More lines than one estimate carries: one line per trade, same total.
    const byTrade = new Map<string, number>();
    for (const line of lines) byTrade.set(line.division ?? "Other Project Work", round2((byTrade.get(line.division ?? "Other Project Work") ?? 0) + line.amount));
    notes.push(`${lines.length} lines were combined into one line per trade`);
    lines = [...byTrade].map(([trade, amount]) => ({ title: trade, description: null, quantity: null, unit: null, amount, division: trade }));
    if (lines.length > MAX_SITE_ESTIMATE_LINES) lines = [];
  }
  if (lines.length) {
    // Each line is rounded to the cent; the cents that rounding moved go on the largest line, so the lines add up to the contract price.
    const drift = round2(base - lines.reduce((sum, line) => sum + line.amount, 0));
    if (drift !== 0 && Math.abs(drift) <= 0.01 * lines.length) {
      const largest = lines.reduce((a, b) => (b.amount > a.amount ? b : a));
      largest.amount = round2(largest.amount + drift);
    }
  }
  const service = typeof record?.scope?.answers?.service === "string" ? record.scope.answers.service.trim().slice(0, 120) : "";
  return { kind: "document", low: round2(low), high: round2(high), base, label: service ? `Document estimate, ${service}` : "Document estimate", lines, verified: true, notes };
}

// ---------------------------------------------------------------------------
// Plumbing: the audit trail, pending work, one run at a time per lead
// ---------------------------------------------------------------------------

export type SiteEstimateContact = { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null };

export type SiteEstimateInput = {
  dealId: number;
  /** The brand whose tool gave the price. The lead's own brand is used when this is not one of the six. */
  brand?: string | null;
  /** As submitted. Anything missing is read from the lead. */
  contact?: SiteEstimateContact | null;
  address?: string | null;
  estimate: SiteEstimate;
  /** Where it came from, for the record: the form's name, or the document estimator's draft. */
  source?: string | null;
};

export type SiteEstimateOutcome = {
  status: "created" | "revised" | "unchanged" | "skipped" | "pending" | "off";
  reason?: string;
  projectId?: number;
  qboEstimateId?: string;
};

async function audit(dealId: number, action: string, detail: unknown, succeeded = true, error: string | null = null): Promise<void> {
  await query(
    `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value,succeeded,error)
     VALUES ('deal',$1,$2,'integration','quickbooks',$3::jsonb,$4,$5)`,
    [String(dealId), action, JSON.stringify(detail), succeeded, error],
  );
}

/** Said once: the same reason for the same lead and kind is not written again and again. */
async function auditSkipped(dealId: number, kind: string, reason: string, detail: Record<string, unknown> = {}): Promise<void> {
  const last = await queryOne<{ reason: string | null; kind: string | null }>(
    `SELECT new_value->>'reason' AS reason, new_value->>'kind' AS kind FROM audit_log
      WHERE record_type='deal' AND record_id=$1 AND action='site_estimate_skipped' ORDER BY id DESC LIMIT 1`,
    [String(dealId)],
  );
  if (last?.reason === reason && last.kind === kind) return;
  await audit(dealId, "site_estimate_skipped", { kind, reason, ...detail });
}

/** The intake read an `estimate` it will not use (malformed, or above a ceiling). Said on the lead's audit trail. Never throws. */
export async function noteSiteEstimateRefused(dealId: number, problem: string): Promise<void> {
  try {
    await auditSkipped(dealId, "unread", problem.slice(0, 300));
  } catch (error) {
    console.error("[site-estimate] a refused estimate was not noted:", (error as Error).message);
  }
}

/** What a retry needs: the estimate and where it came from. The person is read from the lead again. */
type PendingInput = { brand: string | null; source: string | null; estimate: SiteEstimate };

async function markPending(input: SiteEstimateInput, reason: string): Promise<void> {
  const remembered: PendingInput = { brand: input.brand ?? null, source: input.source ?? null, estimate: input.estimate };
  await audit(input.dealId, PENDING, { reason, kind: input.estimate.kind, input: remembered }, false, reason.slice(0, 300));
}
async function clearPending(dealId: number, kind: string): Promise<void> {
  await query(
    `UPDATE audit_log SET succeeded = TRUE WHERE record_type='deal' AND record_id=$1 AND action=$2
        AND succeeded = FALSE AND new_value->>'kind' = $3`,
    [String(dealId), PENDING, kind],
  );
}

/** One lead at a time in this process, so a request and its details a moment later run in turn. */
const queues = new Map<number, Promise<unknown>>();
const background = new Set<Promise<unknown>>();
function inTurn<T>(dealId: number, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(dealId) ?? Promise.resolve();
  const running = previous.then(work, work);
  const settled = running.catch(() => undefined);
  queues.set(dealId, settled);
  background.add(settled);
  void settled.finally(() => {
    background.delete(settled);
    if (queues.get(dealId) === settled) queues.delete(dealId);
  });
  return running;
}
/** Resolves once nothing started here is still running. For tests. */
export async function siteEstimatesSettled(): Promise<void> {
  while (background.size) await Promise.all([...background]);
}

// ---------------------------------------------------------------------------
// One site estimate -> scope project, QuickBooks customer, unsent estimate
// ---------------------------------------------------------------------------

/**
 * Turn one site estimate into a QuickBooks customer and an unsent estimate
 * linked to the lead. Safe to call again with the same input at any time.
 * Never throws: what could not be done is on the lead's audit trail, and a
 * failure worth another try is retried by `settleSiteEstimates`.
 *
 * With `waitMs` the caller is answered after that long at most; work still
 * running then is noted as pending, so the watchdog finishes it even if this
 * process does not.
 */
export async function createSiteEstimate(input: SiteEstimateInput, options: { waitMs?: number } = {}): Promise<SiteEstimateOutcome> {
  try {
    const dealId = Number(input?.dealId);
    if (!Number.isInteger(dealId) || dealId <= 0 || !input.estimate) return { status: "skipped", reason: "There is no lead or no estimate." };
    if (!siteEstimateEnabled()) {
      await auditSkipped(dealId, String(input.estimate.kind), "Site estimates into QuickBooks are switched off (SITE_ESTIMATE_QBO=off).").catch(() => undefined);
      return { status: "off" };
    }
    const work = inTurn(dealId, () => settle({ ...input, dealId }));
    if (options.waitMs === undefined) return await work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      work,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), options.waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
    if (finished) return finished;
    const reason = "Still writing to QuickBooks when the caller was answered.";
    await markPending({ ...input, dealId }, reason).catch(() => undefined);
    return { status: "pending", reason };
  } catch (error) {
    console.error("[site-estimate] the estimate was not carried to QuickBooks:", (error as Error).message);
    return { status: "pending", reason: (error as Error).message.slice(0, 300) };
  }
}

/** Run it, and leave the audit trail saying whether another try is owed. */
async function settle(input: SiteEstimateInput): Promise<SiteEstimateOutcome> {
  let outcome: SiteEstimateOutcome;
  try {
    outcome = await deliver(input);
  } catch (error) {
    outcome = { status: "pending", reason: (error as Error).message.slice(0, 300) };
  }
  try {
    if (outcome.status === "pending") await markPending(input, outcome.reason ?? "The estimate could not be written to QuickBooks.");
    else await clearPending(input.dealId, input.estimate.kind);
  } catch (error) {
    console.error("[site-estimate] the retry note was not saved:", (error as Error).message);
  }
  return outcome;
}

type LeadRow = {
  stage: string; closed_lost_reason: string | null; brand: string; original_form: string | null;
  property_address: string | null; property_city: string | null; property_state: string | null; property_zip: string | null;
  first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Street, city, state and ZIP on one line, each said once. The street comes first: the project is named from it. */
function fullAddress(street: string | null, city: string | null, state: string | null, zip: string | null): string | null {
  if (!street) return null;
  const has = (part: string | null) => Boolean(part) && street.toLowerCase().includes(part!.toLowerCase());
  // The intake appends a ZIP sent on its own to the street; it belongs after the city.
  const line = zip && street.endsWith(`, ${zip}`) ? street.slice(0, -(zip.length + 2)) : street;
  const region = [state && !has(state) ? state : null, zip && (!has(zip) || line !== street) ? zip : null].filter(Boolean).join(" ");
  return [line, city && !has(city) ? city : null, region || null].filter(Boolean).join(", ");
}

async function deliver(input: SiteEstimateInput): Promise<SiteEstimateOutcome> {
  const { dealId } = input;
  const kindSent = String(input.estimate.kind);
  const skip = async (reason: string, detail: Record<string, unknown> = {}): Promise<SiteEstimateOutcome> => {
    await auditSkipped(dealId, kindSent, reason, detail);
    return { status: "skipped", reason };
  };

  // In-process callers (the document estimator, a retry) do not come through
  // the intake, so the same reading, limits and ceilings are applied here.
  const read = readSiteEstimate(input.estimate);
  if (!read.estimate) return skip(read.problem ?? "The estimate could not be read.");
  const estimate: SiteEstimate = { ...read.estimate, notes: [...new Set([...(input.estimate.notes ?? []), ...read.estimate.notes])] };
  const kind = estimate.kind;

  const lead = await queryOne<LeadRow>(
    `SELECT d.stage, d.closed_lost_reason, d.brand, d.original_form, d.property_address, d.property_city, d.property_state, d.property_zip,
            c.first_name, c.last_name, c.email, c.phone
       FROM deal d JOIN contact c ON c.id = d.contact_id WHERE d.id = $1`,
    [dealId],
  );
  if (!lead) return skip("The lead was not found.");
  if (lead.original_form === SYNTHETIC_ESTIMATOR_FORM) return skip("A test lead is never written to QuickBooks.");
  if (lead.stage === "Closed Won" || lead.stage === "Closed Lost") {
    return skip(`The lead is closed (${lead.stage}${lead.closed_lost_reason ? `, ${lead.closed_lost_reason}` : ""}), so no estimate was made for it.`);
  }

  const brand = (BRANDS as readonly string[]).includes(input.brand ?? "") ? (input.brand as Brand) : (BRANDS as readonly string[]).includes(lead.brand) ? (lead.brand as Brand) : null;
  if (!brand) return skip("The lead has no brand this estimate can be filed under.");
  const person = {
    firstName: text(input.contact?.firstName) ?? lead.first_name,
    lastName: text(input.contact?.lastName) ?? lead.last_name,
    email: text(input.contact?.email) ?? lead.email,
    phone: text(input.contact?.phone) ?? lead.phone,
  };
  if (!person.firstName && !person.lastName) return skip("The lead has no name, and a QuickBooks customer needs one.");
  const address = fullAddress(text(input.address) ?? lead.property_address, lead.property_city, lead.property_state, lead.property_zip);

  const { isQboConnected } = await import("../finance/qbo/oauth.ts");
  if (!(await isQboConnected().catch(() => false))) return { status: "pending", reason: "QuickBooks is not connected." };

  const candidate = { doc: siteEstimateDoc(brand, estimate), pricing: siteEstimatePricing(brand, estimate) };
  const tool = siteEstimateTool(kind, brand);
  const store = await import("../scopes/store.ts");
  const scopes = await import("../scopes/qbo.ts");
  const { compareEstimate, estimateStatus } = await import("../scopes/estimate.ts");

  // 1. The scope project: one per lead and kind, found or made under the lead's row lock.
  const found = await transaction(async (client) => {
    await client.query("SELECT id FROM deal WHERE id = $1 FOR UPDATE", [dealId]);
    const existing = await client.query<{ id: number; deleted: boolean; doc: ScopeDoc | null; pricing: PricingResult | null }>(
      `SELECT sp.id::int AS id, (sp.deleted_at IS NOT NULL) AS deleted, v.doc, v.pricing
         FROM scope_project sp LEFT JOIN scope_version v ON v.id = sp.current_version_id
        WHERE sp.lead_deal_id = $1
          AND EXISTS (SELECT 1 FROM scope_event ev WHERE ev.project_id = sp.id AND ev.kind = 'created'
                         AND ev.detail->>'source' = $2 AND ev.detail->>'kind' = $3)
        ORDER BY (sp.deleted_at IS NULL) DESC, sp.id DESC LIMIT 1`,
      [dealId, SITE_ESTIMATE_SOURCE, kind],
    );
    const row = existing.rows[0];
    if (row && !row.deleted) return { projectId: row.id, made: false, removedBefore: false };
    // What a person removed is not made again from the same figures.
    if (row && row.doc && sameSiteEstimate({ doc: row.doc, pricing: row.pricing }, candidate)) return { projectId: row.id, made: false, removedBefore: true };
    const created = await client.query<{ id: string }>(
      `INSERT INTO scope_project (title, client_first_name, client_last_name, client_email, client_phone, project_address, service, lead_deal_id)
       VALUES ('', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [person.firstName, person.lastName, person.email, person.phone, address, SERVICE_BY_BRAND[brand], dealId],
    );
    const projectId = Number(created.rows[0].id);
    await client.query("INSERT INTO scope_event (project_id, kind, detail, actor) VALUES ($1,'created',$2::jsonb,NULL)", [
      projectId,
      JSON.stringify({ source: SITE_ESTIMATE_SOURCE, kind, brand, tool, dealId, from: input.source ?? null }),
    ]);
    return { projectId, made: true, removedBefore: false };
  });
  if (found.removedBefore) return { status: "unchanged", reason: "This estimate was removed earlier and is not made again from the same figures.", projectId: found.projectId };
  const projectId = found.projectId;
  if (found.made) await store.syncProjectTitle(projectId);

  // 2. What is there now: the project's version and its QuickBooks estimate.
  let project = await store.getProject(projectId);
  if (!project) throw new Error("The scope project for this estimate is missing.");
  const current = await store.currentVersion(project);
  if (current && (current.source !== SITE_ESTIMATE_SOURCE || current.created_by !== null)) {
    return skip("A person has worked on this project's scope, so the website's figures were not applied.", figures(estimate, projectId));
  }
  const same = Boolean(current && sameSiteEstimate(current, candidate));
  const estimateRow = await store.latestEstimate(projectId);
  const inQuickBooks = estimateRow?.qbo_estimate_id ? estimateRow : null;
  const live = inQuickBooks && inQuickBooks.txn_status !== "Deleted" ? inQuickBooks : null;
  // QuickBooks holds, or held until a person deleted it, exactly these figures: nothing to do.
  if (same && inQuickBooks && inQuickBooks.version_id === current!.id) {
    return live
      ? { status: "unchanged", projectId, qboEstimateId: live.qbo_estimate_id! }
      : { status: "unchanged", reason: "This estimate was deleted in QuickBooks and is not made again from the same figures.", projectId };
  }

  // 3. An estimate exists with other figures: revise it only while it is exactly as the website left it.
  let revising: { estimateId: number; fromTotal: number | null; markerId: number | null; expected: string | null } | null = null;
  if (live) {
    const { qboRequest } = await import("../finance/qbo/client.ts");
    let raw: Record<string, unknown> | null;
    try {
      raw = (await qboRequest<{ Estimate?: Record<string, unknown> }>(`/estimate/${encodeURIComponent(live.qbo_estimate_id!)}`)).Estimate ?? null;
      if (!raw) throw new Error("QuickBooks returned no estimate.");
    } catch (error) {
      if (!isGone(error as Error)) throw error;
      raw = null;
    }
    if (!raw) {
      // Deleted in QuickBooks, and the customer has now sent new figures: a new estimate is made for them below.
      await store.markEstimateDeleted(live.id);
      await store.logEvent(projectId, "estimate-deleted-in-quickbooks", { docNumber: live.doc_number, foundBy: SITE_ESTIMATE_SOURCE }, NO_EMPLOYEE);
    } else {
      const status = estimateStatus(raw as never, true);
      const createdBy = await queryOne<{ created_by: string | null }>("SELECT created_by::text AS created_by FROM scope_estimate WHERE id = $1", [live.id]);
      const token = String(raw.SyncToken ?? "");
      const untouched =
        status === "created_unsent" &&
        !createdBy?.created_by &&
        (token === "0" || (await savedByWebsiteOnly(projectId, live.id, token))) &&
        !compareEstimate(live.sent_payload as { Line: unknown }, raw as { Line?: unknown; TotalAmt?: number }).changed;
      if (!untouched) {
        await store.logEvent(projectId, "site-estimate-not-applied", { ...figures(estimate, projectId), status, note: "New figures arrived from the website; the estimate was left as it is." }, NO_EMPLOYEE);
        return skip(
          status === "created_unsent"
            ? "A person has worked on the QuickBooks estimate, so the website's new figures were not applied to it."
            : `The QuickBooks estimate is ${status.replace(/_/g, " ")}, so the website's new figures were not applied to it.`,
          figures(estimate, projectId),
        );
      }
      // Said before the write: stage alignment reads it while the write is still being stored.
      const expected = /^\d+$/.test(token) ? String(Number(token) + 1) : null;
      const marker = expected
        ? await queryOne<{ id: string }>(
            "INSERT INTO scope_event (project_id, kind, detail, actor) VALUES ($1,$2,$3::jsonb,NULL) RETURNING id",
            [projectId, WEBSITE_SYNC_EVENT, JSON.stringify({ estimateId: live.id, syncToken: expected, from: token, state: "expected" })],
          )
        : null;
      revising = { estimateId: live.id, fromTotal: live.total === null ? null : Number(live.total), markerId: marker ? Number(marker.id) : null, expected };
    }
  }

  // 4. The version (a new one only for new figures), then QuickBooks: the customer and the estimate, unsent.
  try {
    if (!same) {
      await store.saveVersion({
        projectId,
        doc: candidate.doc,
        pricing: candidate.pricing,
        source: SITE_ESTIMATE_SOURCE,
        note: `${tool}. ${verifiedWords(estimate)}${input.source ? ` ${input.source}.` : ""}`.slice(0, 500),
        status: "in_progress",
        userId: null,
      });
    }
    const customer = await scopes.linkOrCreateCustomer(projectId);
    project = (await store.getProject(projectId))!;
    const version = await store.currentVersion(project);
    if (!version?.pricing) throw new Error("The scope version for this estimate is missing.");
    const settings = await store.loadScopeSettings();
    const built = await scopes.buildPayloadFor(project, version, version.pricing, version.doc, settings);
    if (!built.payload) throw new Error(`QuickBooks is missing these products and services: ${built.missingItems.join(", ")}. Map them in Pricing setup.`);
    const origin = `${tool}. ${verifiedWords(estimate)}`;
    built.payload.CustomerMemo = { value: [siteRangeNote(estimate), origin, built.payload.CustomerMemo?.value ?? ""].filter(Boolean).join("\n").slice(0, 1000) };
    built.payload.PrivateNote = [
      siteRangeNote(estimate),
      origin,
      `Created by the P5 website for lead ${dealId}, scope project ${projectId}, version ${version.version_no}. Customer prices only. Created unsent; review before sending.`,
    ].join("\n").slice(0, 4000);
    const result = await scopes.createOrReviseEstimate({ project, version, payload: built.payload, userId: NO_EMPLOYEE });
    const stored = await store.latestEstimate(projectId);
    if (revising) await confirmWebsiteSync(projectId, revising.markerId, revising.estimateId, stored?.sync_token ?? null);

    // The QuickBooks total must equal the figure the estimate was built on, to the cent.
    const total = stored?.total ? Number(stored.total) : null;
    const mismatch = total !== null && Math.abs(total - estimate.base) > 0.005 ? `QuickBooks total ${total} does not equal the estimate's ${estimate.base}. Check it before sending.` : null;
    const detail = {
      ...figures(estimate, projectId),
      tool,
      from: input.source ?? null,
      qboEstimateId: result.qboId,
      docNumber: stored?.doc_number ?? null,
      quickBooksTotal: total,
      customer: { qboId: customer.qboId, how: customer.how },
      ...(revising ? { previousTotal: revising.fromTotal } : {}),
      ...(estimate.notes.length ? { notes: estimate.notes } : {}),
    };
    await audit(dealId, result.revised ? "site_estimate_revised" : "site_estimate_created", detail, !mismatch, mismatch);
    if (mismatch) await store.logEvent(projectId, "site-estimate-total-mismatch", { expected: estimate.base, quickBooksTotal: total }, NO_EMPLOYEE);
    return { status: result.revised ? "revised" : "created", projectId, qboEstimateId: result.qboId, ...(mismatch ? { reason: mismatch } : {}) };
  } catch (error) {
    // When the write did not happen, the note that it would is taken back, so a person's next save is
    // not mistaken for it. When it did (QuickBooks took it and something after failed), the note stands.
    if (revising?.markerId) {
      const now = await store.latestEstimate(projectId).catch(() => null);
      if (now && now.sync_token === revising.expected) await confirmWebsiteSync(projectId, revising.markerId, revising.estimateId, now.sync_token).catch(() => undefined);
      else await query("DELETE FROM scope_event WHERE id = $1 AND kind = $2", [revising.markerId, WEBSITE_SYNC_EVENT]).catch(() => undefined);
    }
    throw error;
  }
}

/** The figures of one estimate, for the audit trail and the event log. Customer prices only. */
function figures(estimate: SiteEstimate, projectId: number): Record<string, unknown> {
  return { kind: estimate.kind, projectId, low: estimate.low, high: estimate.high, total: estimate.base, lines: estimate.lines.length, verified: estimate.verified, label: estimate.label };
}

const isGone = (error: Error) => /QBO 400/.test(error.message) && /Object Not Found|"code":"610"/i.test(error.message);

/**
 * Is the estimate's SyncToken one that a write the website made by itself
 * left it at? QuickBooks adds one to the token on every save, so stage
 * alignment reads a token above "0" as a person's work (`estimateWorked`).
 * A revision made here, because the visitor sent new figures, is not a
 * person's work: the lead must stay where it is. A later save by anyone moves
 * the token on, and that one counts.
 *
 * The token is noted before the write (stage alignment runs while the write
 * is still being stored) and confirmed after it. A note that was never
 * confirmed (the process stopped in between) stops counting after ten
 * minutes, so a person's later save is not taken for the website's.
 */
export async function savedByWebsiteOnly(projectId: number, estimateId: number, syncToken: string): Promise<boolean> {
  if (!syncToken) return false;
  const row = await queryOne(
    `SELECT 1 FROM scope_event WHERE project_id = $1 AND kind = $2
        AND detail->>'estimateId' = $3 AND detail->>'syncToken' = $4
        AND (detail->>'state' = 'done' OR created_at > now() - interval '10 minutes') LIMIT 1`,
    [projectId, WEBSITE_SYNC_EVENT, String(estimateId), syncToken],
  );
  return Boolean(row);
}

/** After the write: the note is confirmed, at the token QuickBooks actually returned. */
async function confirmWebsiteSync(projectId: number, markerId: number | null, estimateId: number, syncToken: string | null): Promise<void> {
  if (!syncToken) return;
  if (markerId) {
    const confirmed = await query(
      `UPDATE scope_event SET detail = detail || '{"state":"done"}'::jsonb
        WHERE id = $1 AND kind = $2 AND detail->>'syncToken' = $3 RETURNING id`,
      [markerId, WEBSITE_SYNC_EVENT, syncToken],
    );
    if (confirmed.length) return;
    // QuickBooks returned another token than the one expected: the note is replaced.
    await query("DELETE FROM scope_event WHERE id = $1 AND kind = $2", [markerId, WEBSITE_SYNC_EVENT]);
  }
  await query("INSERT INTO scope_event (project_id, kind, detail, actor) VALUES ($1,$2,$3::jsonb,NULL)", [
    projectId, WEBSITE_SYNC_EVENT, JSON.stringify({ estimateId, syncToken, state: "done" }),
  ]);
}

// ---------------------------------------------------------------------------
// The document estimator
// ---------------------------------------------------------------------------

/**
 * The document estimator saved a lead for this record (lib/p5/deliveryAdapter.ts).
 * Its priced lines become the lead's QuickBooks estimate. Bounded, so the
 * delivery job is never held by QuickBooks, and never throws.
 */
export async function createSiteEstimateFromDocument(record: unknown, dealId: number, waitMs = 20_000): Promise<SiteEstimateOutcome> {
  try {
    const source = record as DocumentRecord & { brand?: unknown; contact?: { name?: unknown; email?: unknown; phone?: unknown }; scope?: { answers?: { address?: unknown } } };
    const estimate = documentSiteEstimate(source);
    if (!estimate) return { status: "skipped", reason: "The customer was not shown a price." };
    const names = (text(source.contact?.name) ?? "").split(/\s+/).filter(Boolean);
    return await createSiteEstimate(
      {
        dealId,
        brand: text(source.brand),
        contact: { firstName: names[0] ?? null, lastName: names.slice(1).join(" ") || null, email: text(source.contact?.email), phone: text(source.contact?.phone) },
        address: text(source.scope?.answers?.address),
        estimate,
        source: `Document estimator draft ${String(source.draftId ?? "").slice(0, 36)}${source.revision !== undefined ? `, revision ${String(source.revision).slice(0, 12)}` : ""}`,
      },
      { waitMs },
    );
  } catch (error) {
    console.error("[site-estimate] the document estimate was not carried to QuickBooks:", (error as Error).message);
    return { status: "pending", reason: (error as Error).message.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Retry from the watchdog
// ---------------------------------------------------------------------------

/**
 * Retry what could not finish (QuickBooks disconnected or busy). One attempt
 * per lead and kind every six hours, a few per pass, and only for a
 * fortnight: after that a person can enter it by hand.
 */
export async function settleSiteEstimates(limit = 5): Promise<{ attempted: number; finished: number }> {
  if (!siteEstimateEnabled()) return { attempted: 0, finished: 0 };
  const due = await query<{ deal_id: string; kind: string | null }>(
    `SELECT record_id AS deal_id, new_value->>'kind' AS kind FROM audit_log
      WHERE record_type='deal' AND action=$1 AND NOT succeeded
      GROUP BY record_id, new_value->>'kind'
     HAVING max(occurred_at) < now() - interval '6 hours' AND min(occurred_at) > now() - interval '14 days'
      ORDER BY max(occurred_at) LIMIT $2`,
    [PENDING, limit],
  );
  let finished = 0;
  for (const row of due) {
    const dealId = Number(row.deal_id);
    const latest = await queryOne<{ new_value: { input?: PendingInput } | null }>(
      `SELECT new_value FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action=$2 AND NOT succeeded
          AND new_value->>'kind' IS NOT DISTINCT FROM $3 ORDER BY id DESC LIMIT 1`,
      [row.deal_id, PENDING, row.kind],
    );
    const remembered = latest?.new_value?.input;
    if (!remembered?.estimate) {
      // Nothing to retry with: settle the note so it is not picked up again.
      await query("UPDATE audit_log SET succeeded = TRUE WHERE record_type='deal' AND record_id=$1 AND action=$2 AND NOT succeeded AND new_value->>'kind' IS NOT DISTINCT FROM $3", [row.deal_id, PENDING, row.kind]);
      finished++;
      continue;
    }
    const outcome = await createSiteEstimate({ dealId, brand: remembered.brand, source: remembered.source, estimate: remembered.estimate });
    if (outcome.status !== "pending") finished++;
  }
  return { attempted: due.length, finished };
}
