/**
 * Accept a completed estimate. Free of next/server so tests can call it with
 * a constructed Request.
 *
 * The browser sends selections and contact details. It never sends a price,
 * a quantity or a cost code, and there is nowhere in the body to put one:
 * the server prices the selections itself and returns the customer's view.
 * The response is built by customerEstimate(), which has no field that can
 * carry a cost.
 */

import { isDatabaseConfigured } from "../db.ts";
import { collectAttribution } from "../leads/attribution.ts";
import { savedFinance } from "../scopes/engine.ts";
import { globalAcknowledgements, loadScopeSettings } from "../scopes/store.ts";
import { brandConfig } from "./brands.ts";
import { qboMode } from "./deliver.ts";
import { flowById } from "./flows.ts";
import { customerEstimate, internalReport, priceEstimate, priceWithheld, type PriceContext, type PricedEstimate } from "./price.ts";
import { insertGuided, newToken, type GuidedRow } from "./store.ts";
import type { Answers, BrandId, Contact, PropertyFacts, Submission, Tier } from "./types.ts";

const MAX_BODY_BYTES = 24 * 1024;
const TIERS: Tier[] = ["builder", "mid", "high", "luxury"];

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export type SubmitError = { field: string; message: string };

export function readContact(body: Record<string, unknown>): { contact: Contact | null; errors: SubmitError[] } {
  const raw = (body.contact ?? {}) as Record<string, unknown>;
  const errors: SubmitError[] = [];
  const firstName = text(raw.firstName, 60);
  const lastName = text(raw.lastName, 60);
  const email = text(raw.email, 160).toLowerCase();
  const phoneDigits = text(raw.phone, 40).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!firstName) errors.push({ field: "firstName", message: "Enter your first name." });
  if (!lastName) errors.push({ field: "lastName", message: "Enter your last name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: "email", message: "Enter a valid email address." });
  if (phoneDigits.length !== 10) errors.push({ field: "phone", message: "Enter a 10-digit phone number." });
  if (errors.length) return { contact: null, errors };
  const phone = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
  return { contact: { firstName, lastName, email, phone, marketingConsent: raw.marketingConsent === true }, errors };
}

function readProperty(value: unknown): PropertyFacts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const n = (x: unknown, min: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : null);
  const facts: PropertyFacts = {
    source: text(v.source, 80) || "public property records",
    parcel: text(v.parcel, 40) || null,
    livingSqft: n(v.livingSqft, 200, 30_000),
    yearBuilt: n(v.yearBuilt, 1850, 2100),
    lotAcres: n(v.lotAcres, 0.01, 2000),
    stories: n(v.stories, 1, 6),
    garageSpaces: n(v.garageSpaces, 1, 12),
    jurisdiction: text(v.jurisdiction, 60) || null,
    confirmed: v.confirmed === true,
  };
  return facts.livingSqft || facts.yearBuilt || facts.lotAcres ? facts : null;
}

export type SubmitDeps = {
  /** Pricing inputs saved by the team. Defaults read them from the database. */
  loadContext?: () => Promise<PriceContext>;
  store?: typeof insertGuided;
  /** Called once for a newly stored estimate, to run delivery after the response. */
  deliver?: (row: GuidedRow, estimate: PricedEstimate) => void;
  /** Per-address limit. Returns false to refuse. */
  allow?: (request: Request) => Promise<boolean>;
};

async function defaultContext(): Promise<PriceContext> {
  const [settings, finance, acknowledged] = await Promise.all([loadScopeSettings(), savedFinance(), globalAcknowledgements()]);
  return { settings, finance, acknowledged };
}

export async function handleSubmit(request: Request, deps: SubmitDeps = {}): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request too large." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }
  // Honeypot: a field no person can see or fill.
  if (text(body.company_website, 200)) return Response.json({ ok: false, error: "We could not accept that request." }, { status: 422 });

  const brand = brandConfig(text(body.brand, 20));
  const flow = flowById(text(body.project, 40));
  if (!brand || !flow || !brand.projects.includes(flow.id)) return Response.json({ ok: false, error: "That project is not available." }, { status: 400 });
  if (!brand.live) return Response.json({ ok: false, error: "This estimator is not open yet." }, { status: 403 });
  const clientKey = text(body.clientKey, 64);
  if (!/^[A-Za-z0-9-]{16,64}$/.test(clientKey)) return Response.json({ ok: false, error: "Please reload the page and try again." }, { status: 400 });
  const { contact, errors } = readContact(body);
  if (!contact) return Response.json({ ok: false, errors }, { status: 422 });

  if (deps.allow && !(await deps.allow(request).catch(() => false))) {
    return Response.json({ ok: false, error: `Too many requests from this connection. Please call ${brand.phoneDisplay}.` }, { status: 429 });
  }
  if (!deps.store && !isDatabaseConfigured()) {
    console.error("[estimator] DATABASE_URL is not configured; refusing the submission.");
    return Response.json({ ok: false, error: `We could not prepare your estimate just now. Please call ${brand.phoneDisplay}.` }, { status: 503 });
  }

  const tier = (TIERS as string[]).includes(text(body.tier, 12)) ? (text(body.tier, 12) as Tier) : "mid";
  const address = text(body.address, 240) || null;
  const submission: Submission = {
    brand: brand.id as BrandId,
    project: flow.id,
    tier,
    answers: (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {}) as Answers,
    address,
    property: readProperty(body.property),
    contact,
    clientKey,
    attribution: collectAttribution((body.attribution ?? {}) as Record<string, unknown>) ?? {},
    elapsedMs: typeof body.elapsedMs === "number" && body.elapsedMs > 0 && body.elapsedMs < 86_400_000 ? Math.round(body.elapsedMs) : null,
  };

  try {
    const context = await (deps.loadContext ?? defaultContext)();
    const estimate = priceEstimate(submission, context);
    if (!estimate.doc.tasks.length) return Response.json({ ok: false, error: "Choose at least one item." }, { status: 422 });
    const withheld = priceWithheld(estimate);
    // The official copy leaves QuickBooks only for an estimate that qualified.
    const officialCopy = estimate.review.length === 0 && qboMode() === "send" ? "sending" : "after-review";
    const view = customerEstimate(estimate, { token: newToken(), address, createdAt: new Date(), officialCopy });
    const { row, created } = await (deps.store ?? insertGuided)({
      submission: { ...submission, tier: estimate.tier, answers: estimate.answers },
      estimate,
      customerView: view,
      internal: internalReport(estimate),
      priceWithheld: withheld,
    });
    if (created) deps.deliver?.(row, estimate);
    // A repeat returns the estimate stored the first time, never a second one.
    return Response.json({ ok: true, estimate: row.customer_view }, { status: created ? 201 : 200 });
  } catch (error) {
    console.error("[estimator] submit failed:", (error as Error).message);
    return Response.json({ ok: false, error: `We could not prepare your estimate just now. Please call ${brand.phoneDisplay}.` }, { status: 500 });
  }
}
