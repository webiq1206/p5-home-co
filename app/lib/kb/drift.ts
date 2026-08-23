/**
 * Documentation drift detection.
 *
 * Nightly (and on demand), the live configuration of QuickBooks and HubSpot
 * is compared against what the Knowledge Center documents. On a mismatch the
 * affected articles are FLAGGED for review - never silently rewritten,
 * because a config change can be a mistake as easily as a decision - and an
 * attention item is raised. When a check passes, the articles it watches get
 * their Last Verified date bumped automatically.
 *
 * Comparators are pure; runKbDriftScan wires them to the database.
 */

import { query } from "../db.ts";
import {
  fetchDealPipelineStages,
  fetchDealPropertyNames,
} from "../integrations/hubspot.ts";
import { STAGE_IDS } from "../integrations/hubspot-map.ts";
import { articlesVerifiedBy } from "./index.ts";
import { flagArticle, markArticleVerified } from "./state.ts";

// ---------------------------------------------------------------------------
// Expected configuration that is CODE truth: things the application itself
// depends on, so a live mismatch is a real break, not a preference.
// ---------------------------------------------------------------------------

/** The six divisions. Mirrors the p5_project CHECK constraint and the docs. */
export const REQUIRED_CLASSES = [
  "P5 Corporate / Shared",
  "Boise Construction Co",
  "Boise Remodeling Co",
  "Boise ADU Co",
  "Boise Handyman Co",
  "Boise Cabinet Co",
];

/** Accounts the finance engines and docs reference by number. */
export const KEY_ACCOUNTS: Record<string, string> = {
  "1010": "Operating Checking",
  "1030": "Tax Reserve Savings",
  "1040": "Operating Reserve Savings",
  "2100": "Customer Deposits - Unearned Revenue",
};

/** Deal properties whose absence breaks the HubSpot sync. */
export const REQUIRED_DEAL_PROPERTIES = [
  "p5_brand",
  "p5_lead_source",
  "p5_project_type",
  "p5_sla_status",
  "p5_service_area",
  "p5_external_lead_id",
];

// ---------------------------------------------------------------------------
// Pure comparators.
// ---------------------------------------------------------------------------

export type CheckStatus = "ok" | "drift" | "unverifiable";
export type CheckResult = { key: string; status: CheckStatus; detail: string };

export function compareClasses(live: string[], required: string[] = REQUIRED_CLASSES): string[] {
  const liveSet = new Set(live.map((c) => c.trim()));
  const problems: string[] = [];
  for (const cls of required) {
    if (!liveSet.has(cls)) problems.push(`Class "${cls}" is missing or renamed in QuickBooks.`);
  }
  for (const cls of liveSet) {
    if (!required.includes(cls)) problems.push(`Unexpected class "${cls}" exists in QuickBooks.`);
  }
  return problems;
}

export function compareKeyAccounts(
  live: Record<string, string>,
  expected: Record<string, string> = KEY_ACCOUNTS,
): string[] {
  const problems: string[] = [];
  for (const [num, name] of Object.entries(expected)) {
    const liveName = live[num];
    if (liveName === undefined) {
      problems.push(`Account ${num} ("${name}") is missing.`);
    } else if (liveName.trim().toLowerCase() !== name.trim().toLowerCase()) {
      problems.push(`Account ${num} is named "${liveName}", documentation says "${name}".`);
    }
  }
  return problems;
}

/** Diff live numbered accounts against the accepted baseline snapshot. */
export function compareAccountsToBaseline(
  live: Record<string, string>,
  baseline: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [num, name] of Object.entries(baseline)) {
    const liveName = live[num];
    if (liveName === undefined) problems.push(`Account ${num} "${name}" was removed or deactivated.`);
    else if (liveName !== name) problems.push(`Account ${num} renamed: "${name}" -> "${liveName}".`);
  }
  for (const [num, name] of Object.entries(live)) {
    if (!(num in baseline)) problems.push(`New account ${num} "${name}" was added.`);
  }
  return problems;
}

export function compareStages(
  live: { id: string; label: string }[],
  expected: Record<string, string> = STAGE_IDS,
): string[] {
  const problems: string[] = [];
  const liveById = new Map(live.map((s) => [s.id, s.label]));
  for (const [label, id] of Object.entries(expected)) {
    const liveLabel = liveById.get(id);
    if (liveLabel === undefined) {
      problems.push(`Pipeline stage "${label}" (id ${id}) no longer exists.`);
    } else if (liveLabel.trim() !== label) {
      problems.push(`Stage id ${id} is now labeled "${liveLabel}", documentation says "${label}".`);
    }
  }
  for (const s of live) {
    if (!Object.values(expected).includes(s.id)) {
      problems.push(`New pipeline stage "${s.label}" (id ${s.id}) was added.`);
    }
  }
  return problems;
}

export function compareProperties(
  liveNames: Set<string>,
  required: string[] = REQUIRED_DEAL_PROPERTIES,
): string[] {
  return required
    .filter((name) => !liveNames.has(name))
    .map((name) => `Required HubSpot deal property "${name}" is missing.`);
}

// ---------------------------------------------------------------------------
// Runtime wiring.
// ---------------------------------------------------------------------------

async function loadBaseline(key: string): Promise<Record<string, string> | null> {
  const rows = await query<{ payload: Record<string, string> }>(
    `SELECT payload FROM kb_config_baseline WHERE key = $1`,
    [key],
  );
  return rows[0]?.payload ?? null;
}

export async function captureAccountsBaseline(userId: number | null): Promise<number> {
  const live = await liveNumberedAccounts();
  await query(
    `INSERT INTO kb_config_baseline (key, payload, captured_at, accepted_by)
     VALUES ('qbo-accounts', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload, captured_at = now(), accepted_by = EXCLUDED.accepted_by`,
    [JSON.stringify(live), userId],
  );
  return Object.keys(live).length;
}

async function liveNumberedAccounts(): Promise<Record<string, string>> {
  const rows = await query<{ acct_num: string; name: string }>(
    `SELECT acct_num, name FROM qbo_account WHERE active AND acct_num IS NOT NULL`,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.acct_num] = r.name;
  return out;
}

async function upsertDriftAttention(key: string, detail: string): Promise<void> {
  await query(
    `INSERT INTO attention_item (kind, subject_key, severity, title, detail, entity_url, recommended_action)
     VALUES ('kb_drift', $1, 'warning', $2, $3, '/admin/kb', $4)
     ON CONFLICT (kind, subject_key) WHERE resolved_at IS NULL
     DO UPDATE SET detail = EXCLUDED.detail, updated_at = now()`,
    [
      `kb:${key}`,
      `Documentation may be out of date (${key})`,
      detail,
      "Review the flagged Knowledge Center pages; accept the change or revert the configuration.",
    ],
  );
}

async function resolveDriftAttention(okKeys: string[]): Promise<void> {
  if (!okKeys.length) return;
  await query(
    `UPDATE attention_item
     SET resolved_at = now(), resolution = 'Configuration matches documentation again.'
     WHERE kind = 'kb_drift' AND resolved_at IS NULL
       AND subject_key = ANY($1::text[])`,
    [okKeys.map((k) => `kb:${k}`)],
  );
}

export type DriftScanSummary = {
  checks: CheckResult[];
  flaggedArticles: number;
  verifiedArticles: number;
};

export async function runKbDriftScan(today = new Date()): Promise<DriftScanSummary> {
  const checks: CheckResult[] = [];

  // --- QuickBooks-side checks, from the synced read model -----------------
  const accountRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM qbo_account`,
  );
  const qboSynced = Number(accountRows[0]?.n ?? 0) > 0;

  if (!qboSynced) {
    checks.push({
      key: "qbo-classes",
      status: "unverifiable",
      detail: "QuickBooks has not synced yet; nothing to compare.",
    });
    checks.push({ key: "qbo-key-accounts", status: "unverifiable", detail: "Awaiting first sync." });
    checks.push({ key: "qbo-accounts", status: "unverifiable", detail: "Awaiting first sync." });
  } else {
    const classes = await query<{ name: string }>(`SELECT name FROM qbo_class WHERE active`);
    const classProblems = compareClasses(classes.map((c) => c.name));
    checks.push({
      key: "qbo-classes",
      status: classProblems.length ? "drift" : "ok",
      detail: classProblems.join(" ") || "All 6 classes match.",
    });

    const live = await liveNumberedAccounts();
    const keyProblems = compareKeyAccounts(live);
    checks.push({
      key: "qbo-key-accounts",
      status: keyProblems.length ? "drift" : "ok",
      detail: keyProblems.join(" ") || "Key accounts match.",
    });

    const baseline = await loadBaseline("qbo-accounts");
    if (!baseline) {
      await captureAccountsBaseline(null);
      checks.push({
        key: "qbo-accounts",
        status: "ok",
        detail: "First run: chart-of-accounts baseline captured.",
      });
    } else {
      const acctProblems = compareAccountsToBaseline(live, baseline);
      checks.push({
        key: "qbo-accounts",
        status: acctProblems.length ? "drift" : "ok",
        detail: acctProblems.slice(0, 8).join(" ") || "Chart of accounts unchanged.",
      });
    }
  }

  // --- HubSpot-side checks, via the API when a token exists ----------------
  try {
    const stages = await fetchDealPipelineStages();
    if (stages === null) {
      checks.push({
        key: "hubspot-pipeline",
        status: "unverifiable",
        detail: "HUBSPOT_TOKEN is not configured; pipeline cannot be checked.",
      });
    } else {
      const stageProblems = compareStages(stages);
      checks.push({
        key: "hubspot-pipeline",
        status: stageProblems.length ? "drift" : "ok",
        detail: stageProblems.join(" ") || "All 8 stages match by id and label.",
      });
    }
  } catch (error) {
    checks.push({
      key: "hubspot-pipeline",
      status: "unverifiable",
      detail: `HubSpot unreachable: ${(error as Error).message}`,
    });
  }

  try {
    const names = await fetchDealPropertyNames();
    if (names === null) {
      checks.push({
        key: "hubspot-properties",
        status: "unverifiable",
        detail: "HUBSPOT_TOKEN is not configured; properties cannot be checked.",
      });
    } else {
      const propProblems = compareProperties(names);
      checks.push({
        key: "hubspot-properties",
        status: propProblems.length ? "drift" : "ok",
        detail: propProblems.join(" ") || "Required deal properties present.",
      });
    }
  } catch (error) {
    checks.push({
      key: "hubspot-properties",
      status: "unverifiable",
      detail: `HubSpot unreachable: ${(error as Error).message}`,
    });
  }

  // Items are not in the sync read model, so their article keeps its
  // authored verification date; this is deliberate, not an oversight.
  checks.push({
    key: "qbo-items",
    status: "unverifiable",
    detail: "Items are verified manually; the sync does not pull them.",
  });

  // QBO connection state is a live fact articles reference.
  checks.push({
    key: "qbo-connection",
    status: qboSynced ? "ok" : "unverifiable",
    detail: qboSynced ? "Read model populated." : "Not yet synced.",
  });

  // --- Apply outcomes to articles and the attention queue ------------------
  const todayIso = today.toISOString().slice(0, 10);
  let flagged = 0;
  let verified = 0;
  const okKeys: string[] = [];

  for (const check of checks) {
    const articles = articlesVerifiedBy(check.key);
    if (check.status === "drift") {
      for (const a of articles) {
        await flagArticle(a.slug, check.detail);
        flagged += 1;
      }
      await upsertDriftAttention(check.key, check.detail);
    } else if (check.status === "ok") {
      for (const a of articles) {
        await markArticleVerified(a.slug, todayIso);
        verified += 1;
      }
      okKeys.push(check.key);
    }
  }
  await resolveDriftAttention(okKeys);

  return { checks, flaggedArticles: flagged, verifiedArticles: verified };
}
