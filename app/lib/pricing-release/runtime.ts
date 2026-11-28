/**
 * The approved release every price on this site is computed from.
 *
 * Resolve once per request, then run the whole calculation inside it:
 *
 *   const release = await activeRelease();
 *   const estimate = runWithPricing(release, () => priceEstimate(...));
 *
 * Until an administrator publishes a release, the catalog and rules compiled
 * into this build are the release (baselinePricing). A release that cannot be
 * read or verified never moves prices: the last release this process verified
 * stays in use, and before that the compiled baseline.
 */
import { baselinePricing, runWithPricing } from "../../../lib/p5/pricingReleaseScope.ts";
import type { ActivePricing } from "../../../lib/p5/pricingContext.ts";
// The store needs the session module, which only loads inside Next; it is imported when first used.
const store = () => import("./store.ts");
type Loader = (version?: string) => Promise<{ version: string; digest: string; snapshot: ActivePricing["snapshot"]; generation: number | null }>;
const loadPublishedPricingRelease: Loader = async version => (await store()).loadPublishedPricingRelease(version);
import { forgetSitePricing, registerPricingSource, sitePricing } from "../../../lib/p5/pricingReleaseClient.ts";

let lastGood: ActivePricing | null = null;
let lastProblem: { at: string; message: string } | null = null;


function missingTable(error: unknown): boolean {
  return (error as { code?: string })?.code === "42P01";
}

/** Reads the active release. Injectable for tests. */
export async function resolveActiveRelease(load: Loader = loadPublishedPricingRelease): Promise<ActivePricing> {
  try {
    const row = await load();
    lastProblem = null;
    lastGood = { version: row.version, digest: row.digest, snapshot: row.snapshot, generation: row.generation, source: "published" };
    return lastGood;
  } catch (error) {
    // Nothing published yet (or the release tables are not migrated): the compiled baseline is the release.
    const nothingPublished = missingTable(error) ||
      ((error as { status?: number })?.status === 503 && /No approved pricing release is available/.test((error as Error).message));
    if (nothingPublished && !lastGood) return baselinePricing();
    lastProblem = { at: new Date().toISOString(), message: (error as Error).message };
    console.error("[pricing-release] active release could not be read; keeping the last verified release:", (error as Error).message);
    return lastGood ? { ...lastGood, source: "cached" } : baselinePricing();
  }
}

/** p5homeco.com reads its own release table; the shared client caches and falls back. */
registerPricingSource(async version => {
  if (version) {
    const row = await loadPublishedPricingRelease(version);
    return { version: row.version, digest: row.digest, snapshot: row.snapshot, generation: row.generation, source: "published" as const };
  }
  return resolveActiveRelease();
});

export async function activeRelease(): Promise<ActivePricing> {
  return sitePricing();
}

/** A specific approved version, for replaying or auditing a saved estimate. */
export async function releaseVersion(version: string): Promise<ActivePricing> {
  const base = baselinePricing();
  if (version === base.version && !(await hasPublished(version))) return base;
  const row = await loadPublishedPricingRelease(version);
  return { version: row.version, digest: row.digest, snapshot: row.snapshot, generation: row.generation, source: "published" };
}

async function hasPublished(version: string): Promise<boolean> {
  try { await loadPublishedPricingRelease(version); return true; } catch { return false; }
}

export async function withActivePricing<T>(fn: (release: ActivePricing) => T | Promise<T>): Promise<T> {
  const release = await activeRelease();
  return runWithPricing(release, () => fn(release));
}

/** Called after a publish or rollback so this process does not serve the old pointer for the TTL. */
export function forgetActiveRelease(): void { forgetSitePricing(); }

export function releaseHealth() {
  return { lastVerifiedVersion: lastGood?.version ?? null, lastProblem };
}

export { runWithPricing };
