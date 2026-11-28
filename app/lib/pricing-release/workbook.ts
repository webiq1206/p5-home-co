/**
 * Reading the P5 Cost Book workbook for a pricing release. Server only.
 *
 * Two trusted ways in, both started by a signed-in administrator:
 *   1. The live Google Sheet, read with a service account the owner shared the
 *      workbook with (P5_WORKBOOK_SERVICE_ACCOUNT: the account's JSON key).
 *   2. The workbook downloaded as .xlsx and uploaded on the release screen.
 * Either way the values are unformatted cell values, and the revision recorded
 * with the release is a hash of exactly what was read, so two imports of the
 * same workbook state are the same candidate.
 *
 * Nothing here publishes. It compiles a candidate and describes what changed.
 */
import { createHash, createSign } from "node:crypto";
import { compilePricingWorkbook, CANONICAL_P5_WORKBOOK } from "../../../lib/p5/pricingWorkbook.ts";
import { digestPricingSnapshot, PricingReleaseValidationError, type PricingSnapshot } from "../../../lib/p5/pricingRelease.ts";

export type WorkbookValues = { costBook: unknown[][]; policy: unknown[][] };
export const WORKBOOK_RANGES = ["'Cost Book'!A1:V2500", "'Pricing Policy'!A1:G80"] as const;

export function workbookConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.P5_WORKBOOK_SERVICE_ACCOUNT?.trim());
}

function serviceAccount(env: Readonly<Record<string, string | undefined>>) {
  let key: { client_email?: unknown; private_key?: unknown };
  try { key = JSON.parse(env.P5_WORKBOOK_SERVICE_ACCOUNT || ""); }
  catch { throw new Error("The workbook service account key is not valid JSON."); }
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string") throw new Error("The workbook service account key is incomplete.");
  return { email: key.client_email, privateKey: key.private_key.replace(/\\n/g, "\n") };
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

async function accessToken(fetcher: typeof fetch, env: Readonly<Record<string, string | undefined>>): Promise<string> {
  const { email, privateKey } = serviceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600,
  }))}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url")}`;
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error("Google did not accept the workbook service account. Check that the key is current.");
  return body.access_token;
}

/** Read the live workbook's two source ranges as unformatted values. */
export async function readLiveWorkbook(fetcher: typeof fetch = fetch, env: Readonly<Record<string, string | undefined>> = process.env): Promise<WorkbookValues> {
  const token = await accessToken(fetcher, env);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${CANONICAL_P5_WORKBOOK}/values:batchGet`);
  for (const range of WORKBOOK_RANGES) url.searchParams.append("ranges", range);
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({})) as { valueRanges?: { values?: unknown[][] }[] };
  if (response.status === 403 || response.status === 404) throw new Error("The workbook is not shared with the service account. Share the P5 Cost Book with it as a viewer.");
  if (!response.ok || body.valueRanges?.length !== 2) throw new Error(`The workbook could not be read (${response.status}).`);
  return { costBook: body.valueRanges[0].values ?? [], policy: body.valueRanges[1].values ?? [] };
}

/** Read an uploaded .xlsx copy of the workbook. Formula cells give their calculated value. */
export async function readUploadedWorkbook(file: ArrayBuffer): Promise<WorkbookValues> {
  if (file.byteLength < 100 || file.byteLength > 30 * 1024 * 1024) throw new Error("Upload the P5 Cost Book as an .xlsx file under 30 MB.");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(file); } catch { throw new Error("That file is not a readable .xlsx workbook."); }
  const sheet = (name: string, columns: number): unknown[][] => {
    const ws = book.getWorksheet(name);
    if (!ws) throw new Error(`The workbook has no "${name}" tab.`);
    const rows: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row: unknown[] = [];
      for (let c = 1; c <= columns; c++) {
        let value: unknown = ws.getCell(r, c).value;
        if (value && typeof value === "object") {
          const cell = value as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
          value = cell.error ? "" : cell.result !== undefined ? cell.result : cell.richText ? cell.richText.map(part => part.text).join("") : value instanceof Date ? value.toISOString().slice(0, 10) : cell.text ?? "";
        }
        row.push(value ?? "");
      }
      while (row.length && (row[row.length - 1] === "" || row[row.length - 1] === null)) row.pop();
      rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows;
  };
  return { costBook: sheet("Cost Book", 22), policy: sheet("Pricing Policy", 7) };
}

/** A hash of exactly the values that were read: the source revision recorded with the release. */
export function workbookRevision(values: WorkbookValues): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([values.costBook, values.policy])).digest("hex")}`;
}

export type ReleaseDiff = {
  rateChanges: { code: string; item: string; unit: string; before: number[]; after: number[]; premiumBefore: number; premiumAfter: number }[];
  ruleChanges: { rule: string; before: string; after: string }[];
  lines: number;
};

const show = (value: unknown) => value === null ? "none" : typeof value === "number" ? `${Math.round(value * 10000) / 100}%` : String(value);

/** What a candidate changes against the release in force, in an administrator's terms. */
export function diffSnapshots(active: PricingSnapshot, candidate: PricingSnapshot): ReleaseDiff {
  const before = new Map(active.lines.map(line => [line[0], line]));
  const rateChanges: ReleaseDiff["rateChanges"] = [];
  for (const line of candidate.lines) {
    const old = before.get(line[0]);
    if (!old) continue;
    const a = old.slice(10, 14) as number[], b = line.slice(10, 14) as number[];
    if (a.some((value, i) => value !== b[i]) || old[14] !== line[14]) {
      rateChanges.push({ code: line[0], item: line[3], unit: line[4], before: a, after: b, premiumBefore: old[14], premiumAfter: line[14] });
    }
  }
  const ruleChanges: ReleaseDiff["ruleChanges"] = [];
  for (const [job, next] of Object.entries(candidate.rules.jobPolicies)) {
    const prior = active.rules.jobPolicies[job as keyof typeof active.rules.jobPolicies];
    (["gross target", "concession gross floor", "net target"] as const).forEach((label, i) => {
      if (prior[i] !== next[i]) ruleChanges.push({ rule: `${job}: ${label}`, before: show(prior[i]), after: show(next[i]) });
    });
  }
  for (const key of ["rushMinNet", "rushCabinetMinNet"] as const) {
    if (active.rules[key] !== candidate.rules[key]) ruleChanges.push({ rule: key === "rushMinNet" ? "Rush work: net floor" : "Rush cabinets: net floor", before: show(active.rules[key]), after: show(candidate.rules[key]) });
  }
  return { rateChanges, ruleChanges, lines: candidate.lines.length };
}

export type WorkbookPreview =
  | { ok: true; revision: string; digest: string; snapshot: PricingSnapshot; diff: ReleaseDiff; unchanged: boolean }
  | { ok: false; revision: string; issues: string[] };

/** Compile the workbook against the release in force. Invalid workbooks report what to fix and change nothing. */
export function previewWorkbook(values: WorkbookValues, active: { snapshot: PricingSnapshot; digest: string }): WorkbookPreview {
  const revision = workbookRevision(values);
  try {
    const snapshot = compilePricingWorkbook({ workbookId: CANONICAL_P5_WORKBOOK, costBook: values.costBook, policy: values.policy }, active.snapshot);
    const digest = digestPricingSnapshot(snapshot);
    return { ok: true, revision, digest, snapshot, diff: diffSnapshots(active.snapshot, snapshot), unchanged: digest === active.digest };
  } catch (error) {
    if (error instanceof PricingReleaseValidationError) return { ok: false, revision, issues: [...error.issues] };
    throw error;
  }
}
