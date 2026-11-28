/**
 * Server only. Runs a calculation inside one approved pricing release.
 *
 * AsyncLocalStorage keeps the release with the request across awaits, so two
 * requests priced at the same moment under different releases (a replay of an
 * old version beside a new estimate) never read each other's rates.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { activePricing, installPricingReader, type ActivePricing, type PricingReceiptRef } from "./pricingContext.ts";
import { PRICE_BOOK } from "./priceBook.ts";
import { FIXED_CHARGES, JOB_POLICIES, NET_POLICY_VERSION, MINIMUM_NET_MARGIN } from "./netPricingPolicy.ts";
import { PROJECT_SERVICE_ROLES, PROJECT_SERVICE_RATE } from "./projectServices.ts";
import {
  digestPricingSnapshot, validatePricingSnapshot, type PricingSnapshot, type ReleasedJobPolicy,
} from "./pricingRelease.ts";
import type { JobClass } from "./netPricingPolicy.ts";

const storage = new AsyncLocalStorage<ActivePricing>();
installPricingReader(() => storage.getStore());

export function runWithPricing<T>(release: ActivePricing, fn: () => T): T {
  return storage.run(release, fn);
}

let baseline: ActivePricing | undefined;
/** The catalog and bid rules compiled into this build, as a release. Used until an
 * administrator publishes one, and as the compatibility baseline for every import. */
export function baselinePricing(): ActivePricing {
  if (baseline) return baseline;
  const snapshot: PricingSnapshot = validatePricingSnapshot({
    schemaVersion: 1,
    currency: "USD",
    lines: PRICE_BOOK.map(row => row.slice()),
    rules: {
      minimumNetMargin: MINIMUM_NET_MARGIN,
      jobPolicies: Object.fromEntries(Object.entries(JOB_POLICIES).map(([k, v]) => [k, [...v]])) as Record<JobClass, ReleasedJobPolicy>,
      rushMinNet: 0.25,
      rushCabinetMinNet: 0.3,
      builderMinimumDistinctBookedProjects: 2,
      fixedCharges: Object.fromEntries(Object.entries(FIXED_CHARGES).map(([code, charge]) => [code, charge.price])),
      projectServices: PROJECT_SERVICE_ROLES.map(role => ({
        code: role.code, rate: PROJECT_SERVICE_RATE, qboItemId: role.qboItemId,
        minimumHours: role.minimum, hoursPer1000: role.costFactor * 1000,
      })),
    },
  });
  baseline = { version: NET_POLICY_VERSION, digest: digestPricingSnapshot(snapshot), snapshot, source: "baseline", generation: null };
  return baseline;
}

/** The release in scope, or the compiled baseline. Always defined on a server. */
export function currentPricing(): ActivePricing {
  return activePricing() ?? baselinePricing();
}

export function pricingReceiptRef(): PricingReceiptRef {
  const { version, digest, source } = currentPricing();
  return { version, digest, source };
}
