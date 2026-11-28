/**
 * Which approved pricing release a calculation uses. Browser-safe: no Node import.
 *
 * Every price is computed from ONE approved release: the catalog lines and the
 * bid rules published together. A server entry point resolves the release once
 * and runs the whole calculation inside it (pricingReleaseScope.ts); the book
 * and policy helpers read it through activePricing(). With no release in scope
 * they use the catalog and rules compiled into this build, which is the
 * baseline every published release is checked against.
 */
import type { PricingSnapshot } from "./pricingRelease.ts";

export type ActivePricing = {
  /** The approved release version, for example P5-BID-2026-12-01. */
  version: string;
  /** SHA-256 of the canonical snapshot. */
  digest: string;
  snapshot: PricingSnapshot;
  /** Where it came from: the release table, a sibling site's fetch, or the compiled baseline. */
  source: "published" | "fetched" | "cached" | "baseline";
  generation?: number | null;
};

const KEY = Symbol.for("p5.pricing.active");
type Reader = () => ActivePricing | undefined;

/** Installed once by the server scope module. Never called from a browser. */
export function installPricingReader(reader: Reader): void {
  (globalThis as Record<symbol, unknown>)[KEY] = reader;
}

const DEFAULT = Symbol.for("p5.pricing.default");
/** The release this process last verified. Used when a calculation runs outside a request scope. */
export function setDefaultPricing(release: ActivePricing | undefined): void {
  (globalThis as Record<symbol, unknown>)[DEFAULT] = release;
}

/** The release this calculation runs in, or undefined for the compiled baseline. */
export function activePricing(): ActivePricing | undefined {
  const reader = (globalThis as Record<symbol, unknown>)[KEY];
  const scoped = typeof reader === "function" ? (reader as Reader)() : undefined;
  return scoped ?? ((globalThis as Record<symbol, unknown>)[DEFAULT] as ActivePricing | undefined);
}

/** What a saved estimate records so it can always be traced to the exact release. */
export type PricingReceiptRef = { version: string; digest: string; source: ActivePricing["source"] };
