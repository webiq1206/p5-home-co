/**
 * The one write P5 will make against the real books, to prove the write path
 * works there (S221).
 *
 * ===================== WHY AN ESTIMATE, AND ONLY AN ESTIMATE =====================
 *
 * Everything else in the suite is either pure or read-only, because "create
 * test data then delete it" does not work in QuickBooks: customers and vendors
 * cannot be deleted, only deactivated, and a deleted transaction stays in the
 * audit log permanently. Test records in a production accounting file are a
 * cleanup problem wearing a test's clothing.
 *
 * An Estimate is the exception, and for one specific reason: it is
 * NON-POSTING. It never touches the general ledger. It changes no balance, no
 * trial balance, no profit and loss, no tax figure. Created against a customer
 * and item that already exist, it introduces no new names either. Deleted, the
 * only residue is a line in the audit log saying it existed - which is a true
 * record of something that did happen, not a corruption of the books.
 *
 * It is also worth doing, because it exercises the exact sales-line builder
 * that draw invoices use. Proving invoicePayload produces something QuickBooks
 * accepts, against P5's real items and customers, is the thing a sandbox could
 * never confirm - and getting a draw invoice wrong is how a customer gets
 * billed twice.
 *
 * ============================== THE GUARDS ==============================
 *
 *   1. Opt-in is an exact literal. Not truthy, not "1", not "true" - the
 *      string "yes-write-to-the-real-books". Nobody enables this by
 *      accident or by copying a config.
 *   2. The write helper allows exactly one path: /estimate. Any other entity
 *      throws before a request is made. There is no way to reach an Invoice,
 *      Bill or Payment from this file.
 *   3. Deletion is VERIFIED by querying the record back, not assumed from a
 *      200 response.
 *   4. A cleanup failure fails the test loudly. This is the opposite of the
 *      sandbox suite, where a leftover is a warning - in the real books, a
 *      record we could not remove is the single most important thing to say.
 *
 * ============================== SETUP ==============================
 *
 *   QBO_LIVE_ACCESS_TOKEN            Current token for the P5 company
 *   QBO_LIVE_REALM_ID                The P5 realm id
 *   QBO_LIVE_ALLOW_ESTIMATE_PROBE    Exactly: yes-write-to-the-real-books
 *   QBO_LIVE_PROBE_CUSTOMER_ID       Optional. Which customer to use; the
 *                                    first active one otherwise.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { invoicePayload, requestId } from "../app/lib/finance/qbo/map.ts";

const TOKEN = process.env.QBO_LIVE_ACCESS_TOKEN;
const REALM = process.env.QBO_LIVE_REALM_ID;
const OPT_IN = process.env.QBO_LIVE_ALLOW_ESTIMATE_PROBE;
const CUSTOMER_OVERRIDE = process.env.QBO_LIVE_PROBE_CUSTOMER_ID;
const HOST = "https://quickbooks.api.intuit.com";

/** Deliberately awkward to type, and meaningless unless you meant it. */
const OPT_IN_PHRASE = "yes-write-to-the-real-books";

const enabled = Boolean(TOKEN && REALM) && OPT_IN === OPT_IN_PHRASE;

/**
 * The only entity this file may create. An allowlist of one.
 *
 * Exported so the guard can be tested without credentials - the check matters
 * more than anything it protects.
 */
export function assertProbeTarget(path: string): void {
  const target = path.split("?")[0];
  assert.equal(
    target,
    "/estimate",
    `Refusing "${path}". This probe may only touch /estimate, because an estimate is non-posting. ` +
      `Anything else would change the books.`,
  );
}

export function probeEnabled(optIn: string | undefined): boolean {
  // Exact match only. "true", "1" and "yes" are all rejected on purpose, so
  // that enabling this is always a deliberate act.
  return optIn === OPT_IN_PHRASE;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (init.method && init.method !== "GET") assertProbeTarget(path);
  const url = `${HOST}/v3/company/${REALM}${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error("401 from QuickBooks - the access token has expired.");
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function queryOne<T>(sql: string, entity: string): Promise<T | undefined> {
  const body = await call<{ QueryResponse: Record<string, T[] | undefined> }>(
    `/query?query=${encodeURIComponent(sql)}`,
  );
  return body.QueryResponse[entity]?.[0];
}

describe(
  "live estimate probe (writes one non-posting record, then removes it)",
  {
    skip: enabled
      ? false
      : `disabled - set QBO_LIVE_ALLOW_ESTIMATE_PROBE=${OPT_IN_PHRASE} plus a live token`,
  },
  () => {
    test("the write path works against P5's real customers and items", async () => {
      // Tagged with the clock so a leftover from a crashed run is findable and
      // obviously not a real document.
      const tag = `ZZPROBE-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;

      const customer = CUSTOMER_OVERRIDE
        ? await queryOne<{ Id: string; DisplayName: string }>(
            `SELECT * FROM Customer WHERE Id = '${CUSTOMER_OVERRIDE.replace(/'/g, "")}'`,
            "Customer",
          )
        : await queryOne<{ Id: string; DisplayName: string }>(
            "SELECT * FROM Customer WHERE Active = true MAXRESULTS 1",
            "Customer",
          );
      assert.ok(customer, "no customer available to probe against");

      const item = await queryOne<{ Id: string; Name: string }>(
        "SELECT * FROM Item WHERE Active = true AND Type = 'Service' MAXRESULTS 1",
        "Item",
      );
      assert.ok(item, "no active service item found - P5 should have 13");

      console.log(`[probe] using customer "${customer.DisplayName}" and item "${item.Name}"`);

      // Built with the SAME builder that produces draw invoices. That is the
      // point: this proves the sales-line shape against P5's real item and
      // account configuration, without posting anything.
      const payload = invoicePayload({
        customerQboId: customer.Id,
        docNumber: tag.slice(0, 21), // QuickBooks caps DocNumber length
        customerMemo: `${tag} - automated write-path check. Safe to delete.`,
        lines: [{ itemQboId: item.Id, amount: 0.01, description: `${tag} probe line` }],
      });

      const key = `estimate-probe:${tag}`;
      const created = await call<{ Estimate: { Id: string; SyncToken: string; TotalAmt: number; CustomerRef: { value: string } } }>(
        `/estimate?requestid=${requestId(key)}`,
        { method: "POST", body: JSON.stringify(payload) },
      );

      const estimate = created.Estimate;
      // Checked before the try, so the cleanup block below can rely on it.
      // Inside the try, a missing estimate would throw here and then throw
      // AGAIN in `finally` on estimate.Id, hiding the real failure.
      assert.ok(estimate?.Id, "QuickBooks did not return an estimate");

      let cleanedUp = false;

      try {
        assert.equal(estimate.CustomerRef.value, customer.Id, "attached to the wrong customer");
        assert.equal(estimate.TotalAmt, 0.01, "the line amount did not survive the round trip");

        // The duplicate guard, proven against the real company rather than
        // asserted about our own key function. This is the property that stops
        // a retried draw invoice billing a customer twice.
        const repeat = await call<{ Estimate: { Id: string } }>(
          `/estimate?requestid=${requestId(key)}`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        assert.equal(
          repeat.Estimate.Id,
          estimate.Id,
          "the same request id produced a SECOND record - the idempotency guard does not work against production",
        );
      } finally {
        // Always attempt removal, including when an assertion above failed.
        // A leftover is worse than a failed test.
        try {
          await call(`/estimate?operation=delete`, {
            method: "POST",
            body: JSON.stringify({ Id: estimate.Id, SyncToken: estimate.SyncToken }),
          });
          cleanedUp = true;
        } catch (error) {
          console.error(`[probe] DELETE FAILED for estimate ${estimate.Id}: ${(error as Error).message}`);
        }
      }

      assert.ok(
        cleanedUp,
        `The probe estimate ${estimate.Id} (${tag}) could NOT be deleted and is still in the books. ` +
          `Remove it by hand.`,
      );

      // Verified, not assumed. A 200 from a delete is not proof the record is
      // gone, and this is the real company.
      const stillThere = await queryOne<{ Id: string }>(
        `SELECT * FROM Estimate WHERE Id = '${estimate.Id}'`,
        "Estimate",
      );
      assert.equal(
        stillThere,
        undefined,
        `estimate ${estimate.Id} still queryable after delete - remove it by hand`,
      );

      console.log(`[probe] estimate ${estimate.Id} created, verified and removed. Books unchanged.`);
    });
  },
);

// ---------------------------------------------------------------------------
// The guards run always, with or without credentials. They are the part that
// matters most, so they are never the part that gets skipped.
// ---------------------------------------------------------------------------

test("the probe only ever enables on an exact, deliberate phrase", () => {
  for (const value of [undefined, "", "1", "true", "yes", "YES", "Yes-Write-To-The-Real-Books", " yes-write-to-the-real-books "]) {
    assert.equal(probeEnabled(value), false, `"${value}" must not enable a write to the real books`);
  }
  assert.equal(probeEnabled("yes-write-to-the-real-books"), true);
});

test("the probe refuses every entity except the non-posting one", () => {
  assert.doesNotThrow(() => assertProbeTarget("/estimate"));
  assert.doesNotThrow(() => assertProbeTarget("/estimate?requestid=abc"));
  assert.doesNotThrow(() => assertProbeTarget("/estimate?operation=delete"));

  // Each of these would move money or create a name that cannot be removed.
  for (const path of [
    "/invoice",
    "/bill",
    "/payment",
    "/customer",
    "/vendor",
    "/purchaseorder",
    "/journalentry",
    "/estimates", // near miss
    "/estimate/../invoice",
  ]) {
    assert.throws(() => assertProbeTarget(path), /may only touch \/estimate/, `${path} must be refused`);
  }
});
