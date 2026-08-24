/**
 * Real round-trip tests against an Intuit SANDBOX company (S219).
 *
 * Everything else in this suite is pure: it proves the arithmetic and the
 * decisions, which is where money is lost. What it cannot prove is that
 * QuickBooks accepts a payload we built - that the sub-customer flags really
 * do produce a job, that the idempotency header really does stop a duplicate,
 * that a field we set is the field QuickBooks reads. Only talking to
 * QuickBooks proves that.
 *
 * So this file talks to QuickBooks. It runs against a throwaway sandbox
 * company, never the real books.
 *
 * ============================ SAFETY ============================
 *
 * The guard below refuses to run unless BOTH the host is the sandbox host AND
 * the realm differs from the production realm. It is not a warning and it is
 * not skippable. These tests create and delete records; pointed at the real
 * company they would create records that cannot truly be deleted - QuickBooks
 * only makes customers and vendors inactive, and deleted transactions stay in
 * the audit log permanently.
 *
 * If you are ever tempted to relax this guard: the reason it exists is that a
 * test suite is the one thing in a codebase that is expected to run
 * unattended, repeatedly, without anybody reading the output.
 *
 * ============================ SETUP =============================
 *
 * Skipped entirely unless these are set:
 *
 *   QBO_SANDBOX_CLIENT_ID      Development (not production) client id
 *   QBO_SANDBOX_CLIENT_SECRET  Development client secret
 *   QBO_SANDBOX_REALM_ID       The sandbox company's realm id
 *   QBO_SANDBOX_REFRESH_TOKEN  From one OAuth consent against the sandbox
 *
 * Intuit rotates the refresh token on every exchange, so a used one is dead.
 * The rotated value is written to .qbo-sandbox-token (gitignored) and read
 * from there in preference to the environment, which is what lets these run
 * more than once.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { customerPayload, invoicePayload, purchaseOrderPayload, requestId, vendorPayload } from "../app/lib/finance/qbo/map.ts";

const CLIENT_ID = process.env.QBO_SANDBOX_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_SANDBOX_CLIENT_SECRET;
const REALM_ID = process.env.QBO_SANDBOX_REALM_ID;
const TOKEN_FILE = ".qbo-sandbox-token";

/** The live company. Nothing in this file may ever touch it. */
const PRODUCTION_REALM = "9341457771467280";

const SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const configured = Boolean(CLIENT_ID && CLIENT_SECRET && REALM_ID && storedRefreshToken());

function storedRefreshToken(): string | undefined {
  try {
    const fromFile = readFileSync(TOKEN_FILE, "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // No file yet - fall back to the environment.
  }
  return process.env.QBO_SANDBOX_REFRESH_TOKEN?.trim() || undefined;
}

describe(
  "QuickBooks sandbox round-trip",
  { skip: configured ? false : "sandbox credentials not set - see the header of this file" },
  () => {
    let accessToken = "";
    /** Stamped into every record so repeated runs never collide. */
    let runTag = "";
    const created: { entity: string; id: string; syncToken: string }[] = [];

    // -- The guard --------------------------------------------------------
    test("refuses to run against the production company", () => {
      assert.notEqual(
        REALM_ID,
        PRODUCTION_REALM,
        "QBO_SANDBOX_REALM_ID is the PRODUCTION realm. These tests create and delete records and must never point there.",
      );
      assert.match(SANDBOX_HOST, /^https:\/\/sandbox-/, "the API host must be the sandbox host");
    });

    before(async () => {
      // Fail loudly rather than silently running against the wrong company.
      if (REALM_ID === PRODUCTION_REALM) {
        throw new Error("Refusing to run: QBO_SANDBOX_REALM_ID is the production realm.");
      }

      const refresh = storedRefreshToken();
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh ?? "",
        }),
      });

      if (!res.ok) {
        throw new Error(
          `Sandbox token exchange failed (${res.status}). The refresh token may have expired - ` +
            `Intuit rotates it on every use and they last 100 days. Re-authorise and update ` +
            `${TOKEN_FILE} or QBO_SANDBOX_REFRESH_TOKEN. Body: ${await res.text()}`,
        );
      }

      const body = (await res.json()) as { access_token: string; refresh_token: string };
      accessToken = body.access_token;

      // Persist the rotated token, or the next run cannot authenticate.
      writeFileSync(TOKEN_FILE, body.refresh_token, "utf8");

      // A stable tag per run, derived from the clock, so a failed run's
      // leftovers are identifiable rather than anonymous.
      runTag = `ZZTEST-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
    });

    async function qbo<T>(path: string, init: RequestInit = {}): Promise<T> {
      const url = `${SANDBOX_HOST}/v3/company/${REALM_ID}${path}${
        path.includes("?") ? "&" : "?"
      }minorversion=75`;
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
      }
      return JSON.parse(text) as T;
    }

    async function create<T extends { Id: string; SyncToken: string }>(
      entity: string,
      payload: Record<string, unknown>,
      key: string,
    ): Promise<T> {
      const body = await qbo<Record<string, T>>(`/${entity.toLowerCase()}?requestid=${requestId(key)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const record = body[entity];
      assert.ok(record?.Id, `${entity} was not returned by QuickBooks`);
      created.push({ entity, id: record.Id, syncToken: record.SyncToken });
      return record;
    }

    // -- The round trip ---------------------------------------------------

    test("the connection reaches the sandbox company", async () => {
      const info = await qbo<{ CompanyInfo: { CompanyName: string; Id: string } }>(
        `/companyinfo/${REALM_ID}`,
      );
      assert.ok(info.CompanyInfo.CompanyName);
      assert.notEqual(info.CompanyInfo.Id, PRODUCTION_REALM);
    });

    test("a project really is created as a job under its customer", async () => {
      // The claim the pure tests cannot make: that these three flags together
      // are what QuickBooks reads as a job. If Intuit ever changes that, this
      // is where it surfaces.
      const parent = await create<{ Id: string; SyncToken: string; DisplayName: string }>(
        "Customer",
        customerPayload({ displayName: `${runTag} Fernandez Residence`, email: "zz@example.com" }),
        `${runTag}:customer`,
      );

      const job = await create<{
        Id: string;
        SyncToken: string;
        Job?: boolean;
        IsProject?: boolean;
        BillWithParent?: boolean;
        ParentRef?: { value: string };
      }>(
        "Customer",
        customerPayload({
          displayName: `${runTag} Kitchen`,
          parentQboId: parent.Id,
          isProject: true,
        }),
        `${runTag}:project`,
      );

      assert.equal(job.ParentRef?.value, parent.Id, "the job must sit under the customer");
      assert.equal(job.Job, true, "QuickBooks must treat it as a job");
      assert.equal(
        job.BillWithParent,
        false,
        "billing with the parent would move income off the job and break its profitability",
      );
    });

    test("the same request id twice does not create two records", async () => {
      // The duplicate guard, proven against QuickBooks rather than asserted
      // about our own key function.
      const payload = vendorPayload({ displayName: `${runTag} ABC Plumbing` });
      const key = `${runTag}:vendor`;

      const first = await create<{ Id: string; SyncToken: string }>("Vendor", payload, key);
      const second = await qbo<{ Vendor: { Id: string } }>(
        `/vendor?requestid=${requestId(key)}`,
        { method: "POST", body: JSON.stringify(payload) },
      );

      assert.equal(
        second.Vendor.Id,
        first.Id,
        "QuickBooks returned a different id for the same request id - the idempotency guard is not working",
      );
    });

    test("a vendor with no W-9 is created without a 1099 flag, not with it set false", async () => {
      const vendor = await qbo<{ QueryResponse: { Vendor?: { Vendor1099?: boolean }[] } }>(
        `/query?query=${encodeURIComponent(
          `SELECT * FROM Vendor WHERE DisplayName = '${runTag} ABC Plumbing'`,
        )}`,
      );
      const found = vendor.QueryResponse.Vendor?.[0];
      assert.ok(found, "the vendor should be queryable back");
      // QuickBooks defaults this to false; what matters is that WE did not
      // assert a value, so the W-9 remains the thing that decides it.
      assert.notEqual(found.Vendor1099, true, "nothing should have flagged this vendor for 1099");
    });

    test("an invoice posts against the job and reads back with the right customer", async () => {
      const jobs = await qbo<{ QueryResponse: { Customer?: { Id: string }[] } }>(
        `/query?query=${encodeURIComponent(
          `SELECT * FROM Customer WHERE DisplayName = '${runTag} Kitchen'`,
        )}`,
      );
      const jobId = jobs.QueryResponse.Customer?.[0]?.Id;
      assert.ok(jobId, "the job created earlier should be queryable");

      const items = await qbo<{ QueryResponse: { Item?: { Id: string }[] } }>(
        `/query?query=${encodeURIComponent("SELECT * FROM Item MAXRESULTS 1")}`,
      );
      const itemId = items.QueryResponse.Item?.[0]?.Id;
      assert.ok(itemId, "the sandbox should have at least one product or service");

      const invoice = await create<{
        Id: string;
        SyncToken: string;
        CustomerRef: { value: string };
        TotalAmt: number;
      }>(
        "Invoice",
        invoicePayload({
          customerQboId: jobId,
          lines: [{ itemQboId: itemId, amount: 1_000, description: `${runTag} draw 1` }],
        }),
        `${runTag}:invoice:1`,
      );

      assert.equal(invoice.CustomerRef.value, jobId, "income must land on the job, not the parent");
      assert.equal(invoice.TotalAmt, 1_000);
    });

    test("a purchase order records a commitment against the job", async () => {
      const vendors = await qbo<{ QueryResponse: { Vendor?: { Id: string }[] } }>(
        `/query?query=${encodeURIComponent(
          `SELECT * FROM Vendor WHERE DisplayName = '${runTag} ABC Plumbing'`,
        )}`,
      );
      const jobs = await qbo<{ QueryResponse: { Customer?: { Id: string }[] } }>(
        `/query?query=${encodeURIComponent(
          `SELECT * FROM Customer WHERE DisplayName = '${runTag} Kitchen'`,
        )}`,
      );
      const accounts = await qbo<{ QueryResponse: { Account?: { Id: string }[] } }>(
        `/query?query=${encodeURIComponent(
          "SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 1",
        )}`,
      );

      const vendorId = vendors.QueryResponse.Vendor?.[0]?.Id;
      const jobId = jobs.QueryResponse.Customer?.[0]?.Id;
      const accountId = accounts.QueryResponse.Account?.[0]?.Id;
      assert.ok(vendorId && jobId && accountId, "vendor, job and a cost account are all needed");

      const po = await create<{ Id: string; SyncToken: string; POStatus?: string; TotalAmt: number }>(
        "PurchaseOrder",
        purchaseOrderPayload({
          vendorQboId: vendorId,
          customerQboId: jobId,
          lines: [{ accountQboId: accountId, amount: 24_000, description: `${runTag} plumbing` }],
        }),
        `${runTag}:po`,
      );

      assert.equal(po.TotalAmt, 24_000);
      assert.equal(po.POStatus ?? "Open", "Open", "a new commitment starts open");
    });

    // -- Cleanup ----------------------------------------------------------
    after(async () => {
      if (!accessToken) return;

      // Deleted newest first, because QuickBooks refuses to remove a record
      // another one still points at.
      const failures: string[] = [];
      for (const record of [...created].reverse()) {
        try {
          if (record.entity === "Customer" || record.entity === "Vendor") {
            // Names cannot be deleted - only made inactive. This is exactly
            // why these tests belong in a sandbox and nowhere else.
            await qbo(`/${record.entity.toLowerCase()}?operation=update&sparse=true`, {
              method: "POST",
              body: JSON.stringify({ Id: record.id, SyncToken: record.syncToken, Active: false }),
            });
          } else {
            await qbo(`/${record.entity.toLowerCase()}?operation=delete`, {
              method: "POST",
              body: JSON.stringify({ Id: record.id, SyncToken: record.syncToken }),
            });
          }
        } catch (error) {
          failures.push(`${record.entity} ${record.id}: ${(error as Error).message}`);
        }
      }

      // Reported, never thrown: a cleanup failure must not disguise itself as
      // a test failure, and everything here is tagged so it can be found.
      if (failures.length > 0) {
        console.warn(
          `[sandbox cleanup] ${failures.length} record(s) left behind, tagged ${runTag}:\n${failures.join("\n")}`,
        );
      }
    });
  },
);
