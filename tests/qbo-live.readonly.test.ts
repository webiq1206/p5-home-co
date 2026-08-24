/**
 * Verification against the REAL P5 company, read-only (S220).
 *
 * A sandbox proves the API contract but not P5's configuration: it has a
 * different chart of accounts, no P5 classes, none of the 13 service items,
 * and none of the real jobs. Those are exactly the things worth checking, so
 * this suite checks them where they actually live.
 *
 * ========================= WHY THIS IS SAFE =========================
 *
 * It cannot write. Not by convention - by construction. `read()` is the only
 * way out of this file to Intuit, it hard-codes GET, and it refuses any path
 * that is not a query or a read endpoint. There is no create, update or delete
 * helper here to be tempted by, and adding one would mean deliberately
 * defeating the check in `assertReadOnly`.
 *
 * That matters because the alternative - writing to the real books and
 * cleaning up afterwards - is not actually reversible. QuickBooks will not
 * delete a customer or a vendor, only deactivate it, and a deleted transaction
 * stays in the audit log permanently. Test records in a production accounting
 * file are a cleanup problem wearing a test's clothing.
 *
 * ============================= SETUP ================================
 *
 * Skipped unless both are set:
 *
 *   QBO_LIVE_ACCESS_TOKEN   A current access token for the P5 company.
 *   QBO_LIVE_REALM_ID       The P5 realm id.
 *
 * Access tokens last one hour. That is deliberate rather than inconvenient:
 * a long-lived credential for the real books sitting in a shell profile is a
 * worse problem than re-minting one when you want to run this.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { REQUIRED_PREFERENCES, readPreference } from "../app/lib/finance/qbo/preferences.ts";
import { auditQbo, type AuditSnapshot, type CustomerRecord, type TxnRecord, type VendorRecord } from "../app/lib/finance/qbo/audit.ts";
import { closeLiveConnection, resolveLiveConnection } from "./helpers/live-connection.ts";

const HOST = "https://quickbooks.api.intuit.com";

// Resolved at module load because describe()'s skip reason is evaluated
// synchronously. An expired refresh token becomes a skip REASON rather than a
// crash, so the message reaches whoever ran the suite instead of a stack trace.
let connection: Awaited<ReturnType<typeof resolveLiveConnection>> = null;
let unavailable = "QuickBooks credentials not available";
try {
  connection = await resolveLiveConnection();
} catch (error) {
  unavailable = (error as Error).message;
}

const TOKEN = connection?.accessToken;
const REALM = connection?.realmId;
const configured = Boolean(TOKEN && REALM);

/**
 * The only door out of this file.
 *
 * Method is fixed at GET and the path is checked, so a future edit cannot
 * quietly turn this into a write helper without removing the assertion.
 */
function assertReadOnly(path: string): void {
  const isRead =
    path.startsWith("/query?") ||
    path.startsWith("/preferences") ||
    path.startsWith("/companyinfo/") ||
    /^\/reports\//.test(path);
  assert.ok(isRead, `Refusing "${path}": this suite is read-only against the live company.`);
}

async function read<T>(path: string): Promise<T> {
  assertReadOnly(path);
  const url = `${HOST}/v3/company/${REALM}${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
  const res = await fetch(url, {
    method: "GET", // fixed, not a parameter
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("401 from QuickBooks - the access token has expired. Mint a fresh one.");
    }
    throw new Error(`GET ${path} -> ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function queryAll<T>(entity: string, where = ""): Promise<T[]> {
  const out: T[] = [];
  // QuickBooks caps a page at 1000 and STARTPOSITION is 1-based.
  for (let start = 1; ; start += 1000) {
    const sql = `SELECT * FROM ${entity} ${where} STARTPOSITION ${start} MAXRESULTS 1000`.trim();
    const body = await read<{ QueryResponse: Record<string, T[] | undefined> }>(
      `/query?query=${encodeURIComponent(sql)}`,
    );
    const page = body.QueryResponse[entity] ?? [];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

describe(
  "live P5 company (read-only)",
  { skip: configured ? false : unavailable },
  () => {
    after(async () => {
      await closeLiveConnection();
    });

    test("reports where the credential came from", () => {
      // A run against the wrong company because of a stale environment
      // variable should be obvious in the output, not inferred afterwards.
      console.log("[live] credential source:", connection?.source, "realm:", REALM);
      assert.ok(connection);
    });

    // ---------------------------------------------------------------------
    // Configuration: the things a sandbox could never tell us.
    // ---------------------------------------------------------------------

    test("the token reaches the P5 company and not some other file", async () => {
      const info = await read<{ CompanyInfo: { CompanyName: string; Id: string } }>(
        `/companyinfo/${REALM}`,
      );
      assert.match(
        info.CompanyInfo.CompanyName,
        /P5/i,
        `connected to "${info.CompanyInfo.CompanyName}" - that is not P5`,
      );
    });

    test("every required setting resolves to a real value, not to 'cannot see it'", async () => {
      // This is the mapping that was written from documentation rather than
      // from the tenant. Anything reported unknown here is a field name we
      // guessed wrong, not a setting that is off.
      const body = await read<{ Preferences?: Record<string, unknown> }>("/preferences");
      const prefs = body.Preferences ?? {};

      const unreadable: string[] = [];
      for (const check of REQUIRED_PREFERENCES) {
        const { state, foundAt } = readPreference(prefs, check);
        if (state === "unknown") unreadable.push(check.key);
        else assert.ok(foundAt, `${check.key} resolved but reported no source path`);
      }

      assert.deepEqual(
        unreadable,
        [],
        `these settings could not be read from the live payload, so their field mapping is wrong:\n` +
          `${unreadable.join(", ")}\n\nPayload keys present: ${Object.keys(prefs).join(", ")}`,
      );
    });

    test("the P5 divisions exist as classes and are active", async () => {
      const classes = await queryAll<{ Name: string; Active: boolean }>("Class");
      const active = classes.filter((c) => c.Active).map((c) => c.Name);
      for (const division of [
        "P5 Corporate / Shared",
        "Boise Construction Co",
        "Boise Remodeling Co",
        "Boise Handyman Co",
        "Boise Cabinet Co",
      ]) {
        assert.ok(
          active.some((name) => name.includes(division.replace("P5 ", ""))),
          `division class missing or inactive: ${division}. Present: ${active.join(", ")}`,
        );
      }
    });

    test("the chart of accounts is numbered, as every report here assumes", async () => {
      const accounts = await queryAll<{ Name: string; AcctNum?: string; Active: boolean }>("Account");
      const active = accounts.filter((a) => a.Active);
      assert.ok(active.length > 50, `only ${active.length} active accounts - that is not the P5 chart`);

      const unnumbered = active.filter((a) => !a.AcctNum).map((a) => a.Name);
      assert.deepEqual(
        unnumbered,
        [],
        `accounts with no number, which sort alphabetically and scatter the reports:\n${unnumbered.join("\n")}`,
      );
    });

    test("no cost sits in a catch-all account", async () => {
      // The junk drawer. If anything is in here it is missing from job costs
      // and probably mis-deducted on the return.
      const accounts = await queryAll<{ Name: string; CurrentBalance?: number }>("Account");
      const catchAll = accounts.filter((a) =>
        /uncategorized|ask my accountant/i.test(a.Name),
      );
      const withBalance = catchAll.filter((a) => Math.abs(a.CurrentBalance ?? 0) > 0.005);
      assert.deepEqual(
        withBalance.map((a) => `${a.Name}: ${a.CurrentBalance}`),
        [],
        "money is sitting in a catch-all account",
      );
    });

    // ---------------------------------------------------------------------
    // Structure: the rules, checked against the real records.
    // ---------------------------------------------------------------------

    test("every job really is a sub-customer that bills itself", async () => {
      const customers = await queryAll<{
        Id: string;
        DisplayName: string;
        Active: boolean;
        Job?: boolean;
        IsProject?: boolean;
        BillWithParent?: boolean;
        ParentRef?: { value: string };
      }>("Customer");

      const jobs = customers.filter((c) => c.Active && (c.Job || c.IsProject || c.ParentRef));

      const wrong = jobs
        .filter((j) => !j.ParentRef || j.BillWithParent === true)
        .map((j) => `${j.DisplayName} (parent=${j.ParentRef?.value ?? "none"}, billWithParent=${j.BillWithParent})`);

      assert.deepEqual(
        wrong,
        [],
        "jobs that will not accumulate their own income:\n" + wrong.join("\n"),
      );
    });

    test("no vendor is flagged for 1099 without the paperwork behind it", async () => {
      const vendors = await queryAll<{ DisplayName: string; Active: boolean; Vendor1099?: boolean; TaxIdentifier?: string }>(
        "Vendor",
      );
      const flaggedWithoutId = vendors
        .filter((v) => v.Active && v.Vendor1099 === true && !v.TaxIdentifier)
        .map((v) => v.DisplayName);

      assert.deepEqual(
        flaggedWithoutId,
        [],
        "flagged to receive a 1099 but no tax id on file - the form cannot actually be filed:\n" +
          flaggedWithoutId.join("\n"),
      );
    });

    // ---------------------------------------------------------------------
    // The daily check, run against the real books, right now.
    // ---------------------------------------------------------------------

    describe("the morning data-quality check, against live data", () => {
      let snapshot: AuditSnapshot;

      before(async () => {
        const [customers, vendors, invoices, bills, pos] = await Promise.all([
          queryAll<Record<string, unknown>>("Customer"),
          queryAll<Record<string, unknown>>("Vendor"),
          queryAll<Record<string, unknown>>("Invoice"),
          queryAll<Record<string, unknown>>("Bill"),
          queryAll<Record<string, unknown>>("PurchaseOrder"),
        ]);

        const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
        const ref = (v: unknown) =>
          v && typeof v === "object" ? ((v as { value?: string }).value ?? null) : null;

        const asTxn = (r: Record<string, unknown>): TxnRecord => ({
          qboId: String(r.Id),
          docNumber: (r.DocNumber as string) ?? null,
          txnDate: (r.TxnDate as string) ?? null,
          dueDate: (r.DueDate as string) ?? null,
          total: num(r.TotalAmt),
          balance: num(r.Balance),
          customerQboId: ref(r.CustomerRef),
          vendorQboId: ref(r.VendorRef),
          poStatus: (r.POStatus as string) ?? null,
          vendorDocNumber: (r.DocNumber as string) ?? null,
          hasBillableLine: Array.isArray(r.Line)
            ? (r.Line as Record<string, never>[]).some((l) =>
                JSON.stringify(l).includes('"BillableStatus":"Billable"'),
              )
            : false,
          hasUncategorizedLine: Array.isArray(r.Line)
            ? (r.Line as unknown[]).some((l) => /uncategorized|ask my accountant/i.test(JSON.stringify(l)))
            : false,
          hasCommitment: Array.isArray(r.LinkedTxn)
            ? (r.LinkedTxn as { TxnType?: string }[]).some((k) => k.TxnType === "PurchaseOrder")
            : false,
        });

        snapshot = {
          today: new Date().toISOString().slice(0, 10),
          form1099Threshold: 600,
          commitmentThreshold: 2_500,
          staleSyncHours: 24,
          hoursSinceSync: 0, // read live, so by definition current
          unresolvedWrites: [],
          customers: customers.map(
            (c): CustomerRecord => ({
              qboId: String(c.Id),
              displayName: String(c.DisplayName ?? ""),
              parentQboId: ref(c.ParentRef),
              isProject: c.IsProject === true,
              billWithParent: c.BillWithParent === true,
              active: c.Active !== false,
              balance: num(c.Balance),
              email: ((c.PrimaryEmailAddr as { Address?: string })?.Address) ?? null,
              billingAddress: ((c.BillAddr as { Line1?: string })?.Line1) ?? null,
            }),
          ),
          vendors: vendors.map(
            (v): VendorRecord => ({
              qboId: String(v.Id),
              displayName: String(v.DisplayName ?? ""),
              active: v.Active !== false,
              balance: num(v.Balance),
              vendor1099: typeof v.Vendor1099 === "boolean" ? v.Vendor1099 : null,
              email: ((v.PrimaryEmailAddr as { Address?: string })?.Address) ?? null,
              // Read-only: P5's own compliance records are not reachable from
              // here, so these are set so as never to invent a finding.
              w9OnFile: Boolean(v.TaxIdentifier),
              taxClassification: null,
              paidThisYear: 0,
              trackedInP5: true,
              paymentHold: false,
            }),
          ),
          invoices: invoices.map(asTxn),
          bills: bills.map(asTxn),
          purchaseOrders: pos.map(asTxn),
          projects: [],
          subcontracts: [],
        };
      });

      test("nothing critical is wrong in the live books", () => {
        const critical = auditQbo(snapshot)
          .filter((f) => f.rule.severity === "critical")
          .map((f) => `${f.rule.label}: ${f.entityName} - ${f.detail}`);

        assert.deepEqual(critical, [], "critical findings in the live company:\n" + critical.join("\n"));
      });

      test("the full finding list is reported, so it can be read rather than guessed at", () => {
        // Not an assertion about the count - the point is visibility. A live
        // company legitimately has warnings; what matters is that they are
        // known rather than discovered in March.
        const findings = auditQbo(snapshot);
        const bySeverity = findings.reduce<Record<string, number>>((acc, f) => {
          acc[f.rule.severity] = (acc[f.rule.severity] ?? 0) + 1;
          return acc;
        }, {});
        console.log(`[live audit] ${findings.length} finding(s):`, bySeverity);
        for (const f of findings.slice(0, 40)) {
          console.log(`  [${f.rule.severity}] ${f.rule.label} - ${f.entityName}: ${f.detail}`);
        }
        assert.ok(Array.isArray(findings));
      });
    });
  },
);

// ---------------------------------------------------------------------------
// The guard itself is tested, because it is the only thing standing between
// this file and the real books.
// ---------------------------------------------------------------------------

test("the live suite refuses any path that is not a read", () => {
  for (const path of ["/query?query=SELECT%20*", "/preferences", "/companyinfo/123", "/reports/ProfitAndLoss"]) {
    assert.doesNotThrow(() => assertReadOnly(path), path);
  }
  for (const path of ["/invoice", "/customer?operation=delete", "/bill?requestid=x", "/vendor"]) {
    assert.throws(() => assertReadOnly(path), /read-only/, `${path} must be refused`);
  }
});
