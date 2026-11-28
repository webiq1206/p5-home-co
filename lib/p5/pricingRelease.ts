/** Server-only canonical artifact. Never expose the internal catalog via a public pricing route. */
import { createHash } from "node:crypto";
import type { PriceBookRow } from "./priceBookData.ts";
import type { JobClass } from "./netPricingPolicy.ts";
import type { ProjectServiceCode } from "./projectServices.ts";

export type ReleasedJobPolicy = [gross: number, concessionGross: number | null, net: number];
export type ReleasedProjectService = {
  code: ProjectServiceCode;
  rate: number;
  qboItemId: string;
  minimumHours: number;
  hoursPer1000: number;
};
export type PricingSnapshot = {
  schemaVersion: 1;
  currency: "USD";
  lines: PriceBookRow[];
  rules: {
    minimumNetMargin: number;
    jobPolicies: Record<JobClass, ReleasedJobPolicy>;
    rushMinNet: number;
    rushCabinetMinNet: number;
    builderMinimumDistinctBookedProjects: number;
    projectServices: ReleasedProjectService[];
  };
};

// Frozen schema-1 guardrails, not mutable defaults imported from the current build.
// Changing a protected floor requires a new contract, not silently reinterpreting a historical release.
const JOBS = {
  "builder-cabinets": [.25, null, .22],
  "retail-cabinets": [.30, null, .30],
  "installed-cabinets": [.32, null, .30],
  "same-layout-kitchen": [.30, .28, .18],
  "standard-remodel": [.32, .30, .18],
  "complex-remodel": [.35, null, .20],
  "short-service": [.40, .35, .18],
  "simple-addition": [.32, .30, .18],
  "verified-conversion": [.32, .30, .18],
  "protected": [0, null, .20],
} as const satisfies Record<JobClass, readonly [number, number | null, number]>;
const SERVICES = { "01-31-03": "48", "01-31-04": "49", "01-31-05": "47" } as const satisfies Record<ProjectServiceCode, string>;
const UNITS = new Set(["HR", "SF", "EA", "LF", "MO", "DAY", "TON", "SQ", "RL", "W", "AC", "CY"]);
const PERCENT_UNITS = new Set(["% of const.", "% of cost"]);
const TYPES = new Set([
  "Fee / Professional Service", "Labor Only", "Service Fee", "Equipment / Service",
  "Labor + Material (Installed)", "Labor + Equipment", "Labor + Disposal",
  "Labor + Minor Materials", "Material Only",
]);
const RULE_KEYS = ["minimumNetMargin", "jobPolicies", "rushMinNet", "rushCabinetMinNet", "builderMinimumDistinctBookedProjects", "projectServices"];
const SERVICE_KEYS = ["code", "rate", "qboItemId", "minimumHours", "hoursPer1000"];

export class PricingReleaseValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super("Pricing release cannot be approved. Review the highlighted lines and rules.");
    this.name = "PricingReleaseValidationError";
    this.issues = issues;
  }
}

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const validNumber = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const cleanText = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && v.length <= max && v.trim().length >= min && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v);
export const validPricingVersion = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z0-9][A-Z0-9._-]{2,79}$/.test(v);
export const validPricingDigest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export function validatePricingSnapshot(value: unknown): PricingSnapshot {
  const issues: string[] = [];
  const issue = (message: string) => { if (issues.length < 70) issues.push(message); };
  if (!object(value) || !exactKeys(value, ["schemaVersion", "currency", "lines", "rules"]) ||
      value.schemaVersion !== 1 || value.currency !== "USD") {
    throw new PricingReleaseValidationError(["Expected the supported USD workbook release schema (version 1)."]);
  }
  const { lines, rules } = value;
  if (!Array.isArray(lines) || !lines.length || lines.length > 20000) {
    issue("Supply between 1 and 20,000 unique catalog lines.");
  }
  const lineMap = new Map<string, PriceBookRow>();
  for (const [index, line] of (Array.isArray(lines) && lines.length <= 20000 ? lines : []).entries()) {
    if (!Array.isArray(line) || line.length !== 16) {
      issue(`Catalog row ${index + 1}: expected all 16 catalog fields.`);
      continue;
    }
    const [code, division, section, label, unit, type, allowance, laborShare, flags, finishSensitive, builder, mid, high, luxury, premium, notes] = line;
    if (typeof code !== "string" || !/^[A-Z0-9][A-Z0-9-]{2,25}$/.test(code)) {
      issue(`Catalog row ${index + 1}: enter a valid unique cost code.`);
      continue;
    }
    if (lineMap.has(code)) { issue(`Duplicate cost code ${code}.`); continue; }
    lineMap.set(code, line as PriceBookRow);
    if (![division, section, label].every(v => cleanText(v, 1, 250)) || !cleanText(allowance, 0, 500) || !cleanText(notes, 0, 4000)) {
      issue(`${code}: division, section, description or notes are invalid.`);
    }
    const percent = type === "Percentage";
    if (percent ? !PERCENT_UNITS.has(unit) : !UNITS.has(unit) || !TYPES.has(type)) {
      issue(`${code}: unsupported UOM and cost-type combination.`);
    }
    if (laborShare !== null && !validNumber(laborShare, 0, 1)) issue(`${code}: labor share must be between 0 and 1.`);
    if (!Number.isInteger(flags) || flags < 1 || flags > 127) issue(`${code}: invalid service flags.`);
    if (finishSensitive !== 0 && finishSensitive !== 1) issue(`${code}: finish-sensitive flag must be 0 or 1.`);
    const tiers = [builder, mid, high, luxury];
    if (!tiers.every(v => validNumber(v, Number.MIN_VALUE, percent ? .999999 : 100000000)) ||
        tiers.some((v, i) => i > 0 && v < tiers[i - 1])) {
      issue(`${code}: four valid, nondecreasing finish rates are required.`);
    }
    if (!validNumber(premium, 0, 1)) issue(`${code}: invalid remodel premium.`);
  }
  if (!object(rules) || !exactKeys(rules, RULE_KEYS)) {
    issue("The release must include the full approved bid rule set.");
  } else {
    if (rules.minimumNetMargin !== .15) issue("The private concession floor must be 15% net.");
    if (rules.builderMinimumDistinctBookedProjects !== 2) issue("Builder stock pricing requires two prior distinct booked projects or verified steady-builder status.");
    if (!validNumber(rules.rushMinNet, .25, .95) || !validNumber(rules.rushCabinetMinNet, .30, .95) ||
        Number(rules.rushCabinetMinNet) < Number(rules.rushMinNet)) issue("Rush requires at least 25% net; rush cabinets require at least 30% and may not be lower than the rush rule.");
    if (!object(rules.jobPolicies) || !exactKeys(rules.jobPolicies, Object.keys(JOBS))) {
      issue("Include exactly one policy for every supported job class.");
    } else {
      for (const [job, [grossFloor, permittedConcessionFloor, netFloor]] of Object.entries(JOBS)) {
        const policy = rules.jobPolicies[job];
        if (!Array.isArray(policy) || policy.length !== 3) { issue(`${job}: invalid job policy.`); continue; }
        const [gross, concession, net] = policy;
        const flexible = ["complex-remodel", "protected"].includes(job);
        if (!validNumber(gross, grossFloor, .95) || (flexible ? !validNumber(net, netFloor, .95) : net !== netFloor)) {
          issue(`${job}: gross floor or net target conflicts with approved limits.`);
        }
        if (permittedConcessionFloor === null ? concession !== null :
            concession !== null && (!validNumber(concession, permittedConcessionFloor, .95) || concession > gross)) {
          issue(`${job}: invalid or prohibited concession gross floor.`);
        }
      }
    }
    if (!Array.isArray(rules.projectServices) || rules.projectServices.length !== 3) {
      issue("Include project management, administration, and accounting exactly once.");
    } else {
      const serviceCodes = new Set<string>();
      for (const svc of rules.projectServices) {
        if (!object(svc) || !exactKeys(svc, SERVICE_KEYS) || typeof svc.code !== "string" ||
            !Object.hasOwn(SERVICES, svc.code) || serviceCodes.has(svc.code)) {
          issue("The internal service rules have an unknown or duplicate service code.");
          continue;
        }
        const code = svc.code as ProjectServiceCode;
        serviceCodes.add(code);
        if (svc.rate !== 125 || svc.qboItemId !== SERVICES[code] ||
            !validNumber(svc.minimumHours, .00004, 100000) || !validNumber(svc.hoursPer1000, Number.MIN_VALUE, 100000)) {
          issue(`${code}: keep the approved $125 hourly rate, linked QuickBooks item, and positive hour defaults.`);
        }
        const row = lineMap.get(code);
        if (!row || row[4] !== "HR" || row[5] !== "Labor Only" || row.slice(10,14).some(v => v !== 125) || row[14] !== 0) {
          issue(`${code}: its book line must be an unmarked-up $125 hourly client rate.`);
        }
      }
    }
  }
  if (issues.length) throw new PricingReleaseValidationError(issues);
  return structuredClone(value) as PricingSnapshot;
}

/** Prevent a missing/renumbered recipe SKU or UOM change from silently repricing existing routes. */
export function requireCatalogCompatibility(snapshot: PricingSnapshot, required: readonly PriceBookRow[]): void {
  const expected = new Map(required.map(row => [row[0], row] as const));
  const next = new Map(snapshot.lines.map(row => [row[0], row] as const));
  const issues: string[] = [];
  for (const [code, before] of expected) {
    const after = next.get(code);
    if (!after) issues.push(`${code}: missing a cost code still used by the deployed catalog.`);
    else if (before[4] !== after[4] || before[5] !== after[5]) {
      issues.push(`${code}: changing the unit or cost type requires reviewing the affected pricing paths first.`);
    }
    if (issues.length >= 70) break;
  }
  if (issues.length) throw new PricingReleaseValidationError(issues);
}

export function canonicalPricingJSON(value: PricingSnapshot): string {
  function stringify(obj: unknown): string {
    if (Array.isArray(obj)) return `[${obj.map(stringify).join(",")}]`;
    if (object(obj)) return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${stringify(obj[key])}`).join(",")}}`;
    return JSON.stringify(obj);
  }
  return stringify(value);
}

export function digestPricingSnapshot(value: PricingSnapshot): string {
  return createHash("sha256").update(canonicalPricingJSON(value), "utf8").digest("hex");
}
