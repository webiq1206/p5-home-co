/**
 * Server only. How a site learns which approved pricing release to price from.
 *
 * p5homeco.com owns the release (its database). It registers its own source at
 * startup. Every other family site fetches the active release from p5homeco.com
 * with a shared token, verifies its digest and schema, and prices from that:
 * an administrator publishes once and no site needs an edit or a deploy.
 *
 * Nothing unverified ever moves a price. A fetch that fails, a digest that does
 * not match, or a release this build cannot price (a catalog code this build
 * needs is missing, or a unit changed) leaves the last verified release in use;
 * before any release was verified, the catalog compiled into the build.
 */
import { setDefaultPricing, type ActivePricing } from "./pricingContext.ts";
import { baselinePricing, runWithPricing } from "./pricingReleaseScope.ts";
import {
  digestPricingSnapshot, requireCatalogCompatibility, validPricingDigest, validPricingVersion, validatePricingSnapshot,
} from "./pricingRelease.ts";
import { PRICE_BOOK } from "./priceBook.ts";

export const P5_PRICING_RELEASE_URL = "https://p5homeco.com/api/pricing/release";
const SOURCE = Symbol.for("p5.pricing.source");
type Source = (version?: string) => Promise<ActivePricing>;
const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;

let cached: { at: number; release: ActivePricing } | null = null;
let lastGood: ActivePricing | null = null;
let lastProblem: { at: string; message: string } | null = null;
const byVersion = new Map<string, ActivePricing>();

/** p5homeco.com registers its database reader here (instrumentation). */
export function registerPricingSource(source: Source): void {
  (globalThis as Record<symbol, unknown>)[SOURCE] = source;
}

/** Verify a release received over the network exactly as the database reader verifies a stored one. */
export function verifyReleasePayload(body: unknown): ActivePricing {
  const value = body as { version?: unknown; digest?: unknown; generation?: unknown; snapshot?: unknown };
  if (!value || !validPricingVersion(value.version) || !validPricingDigest(value.digest)) throw new Error("The pricing release receipt is invalid.");
  const snapshot = validatePricingSnapshot(value.snapshot);
  if (digestPricingSnapshot(snapshot) !== value.digest) throw new Error("The pricing release digest did not match its contents.");
  requireCatalogCompatibility(snapshot, PRICE_BOOK);
  const generation = typeof value.generation === "number" && Number.isSafeInteger(value.generation) ? value.generation : null;
  return { version: value.version, digest: value.digest, snapshot, generation, source: "fetched" };
}

export async function fetchPricingRelease(version?: string, fetcher: typeof fetch = fetch, env: Readonly<Record<string, string | undefined>> = process.env): Promise<ActivePricing> {
  const token = env.P5_PRICING_RELEASE_TOKEN?.trim();
  if (!token) return baselinePricing();
  const url = new URL(env.P5_PRICING_RELEASE_URL?.trim() || P5_PRICING_RELEASE_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("The pricing release address must use HTTPS.");
  if (version) url.searchParams.set("version", version);
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
  });
  if (!response.ok) throw new Error(`The pricing release request failed (${response.status}).`);
  const body = await response.json() as { baseline?: boolean };
  // p5homeco.com has published nothing yet: every site prices from the same compiled baseline.
  if (body?.baseline === true) return baselinePricing();
  return verifyReleasePayload(body);
}

function source(): Source {
  const registered = (globalThis as Record<symbol, unknown>)[SOURCE];
  return typeof registered === "function" ? registered as Source : version => fetchPricingRelease(version);
}

/** The release this site prices from right now. Never throws. */
export async function sitePricing(): Promise<ActivePricing> {
  if (process.env.P5_PRICING_RELEASE === "off") return baselinePricing();
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.release;
  let release: ActivePricing;
  try {
    release = await source()();
    lastGood = release; lastProblem = null;
  } catch (error) {
    lastProblem = { at: new Date().toISOString(), message: String((error as Error)?.message || error).slice(0, 300) };
    console.error("[pricing-release] keeping the last verified release:", lastProblem.message);
    release = lastGood ? { ...lastGood, source: "cached" } : baselinePricing();
  }
  cached = { at: now, release };
  byVersion.set(release.version, release);
  setDefaultPricing(release);
  return release;
}

/** A named approved version (a queued job finishing under the release it started with). Throws when it cannot be verified. */
export async function sitePricingVersion(version: string): Promise<ActivePricing> {
  const known = byVersion.get(version);
  if (known) return known;
  const base = baselinePricing();
  const active = await sitePricing();
  if (active.version === version) return active;
  let release: ActivePricing;
  try { release = await source()(version); }
  catch (error) { if (version === base.version) return base; throw error; }
  if (release.version !== version) throw new Error("The requested pricing version is not available.");
  byVersion.set(version, release);
  return release;
}

/** Resolve the release once and run the whole calculation inside it. */
export async function withSitePricing<T>(fn: (release: ActivePricing) => T | Promise<T>, version?: string): Promise<T> {
  const release = version ? await sitePricingVersion(version) : await sitePricing();
  return runWithPricing(release, () => fn(release));
}

export function forgetSitePricing(): void { cached = null; }
export function sitePricingHealth() {
  return { active: cached?.release ? { version: cached.release.version, digest: cached.release.digest, source: cached.release.source } : null,
    lastVerified: lastGood ? { version: lastGood.version, digest: lastGood.digest } : null, lastProblem };
}
