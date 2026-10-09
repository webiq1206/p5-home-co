import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { ImapFlow } from "imapflow";
import { InboxApiError, InboxHubSpot } from "../app/lib/integrations/inbox-hubspot.ts";
import { InboxStore, type Read } from "../app/lib/integrations/inbox-store.ts";
import { MAILBOX, type Mail } from "../app/lib/integrations/inbox-policy.ts";
import { OWNER_DIAGNOSTIC as approved, diagnosticCopy, diagnosticConfiguration, readOwnerSource, runOwnerDiagnostic, type DiagnosticDependencies } from "../app/lib/integrations/inbox-diagnostic.ts";

const actor = { id: 1, role: "administrator", isActive: true }, origin = "https://p5homeco.com";
const context = { actor, origin, confirmed: true };
const env = { SMTP_USER: MAILBOX, SMTP_PASSWORD: "synthetic-password", HUBSPOT_TOKEN: "synthetic-token" };
function source(overrides: Partial<Mail> = {}): Mail {
  return { messageId: approved.rfc, subject: approved.subject, sentAt: approved.sentAt, receivedAt: approved.sentAt,
    from: [{ email: approved.sender, name: "Owner" }], to: [{ email: MAILBOX, name: "P5" }], cc: [],
    text: "Synthetic owner test body for offline tests only.", html: "<p>Synthetic owner test body for offline tests only.</p>",
    headers: [{ key: "date", line: "Date: Thu, 08 Oct 2026 16:23:05 +0000" }], attachments: [], labels: ["\\All"], ...overrides };
}
function fixtureCrm(overrides: Record<string, unknown> = {}) {
  return { preflight: async () => {}, call: async () => ({ id: approved.contactId, properties: { email: approved.sender } }),
    readExisting: async () => ({ id: approved.nativeEmailId, associations: { contacts: { results: [{ id: approved.contactId }] } } }),
    findEmail: async () => null, createEmail: async () => "diagnostic-created", verify: async () => {}, ...overrides } as unknown as InboxHubSpot;
}
function dependencies(overrides: Partial<DiagnosticDependencies> = {}): DiagnosticDependencies {
  return { env, read: async () => { throw new Error("Probe must not use database receipts"); }, crm: () => fixtureCrm(),
    source: async () => ({ mail: source(), uid: 42, uidValidity: "1" }), ...overrides };
}

test("probe identifies each failed HTTP read, stops immediately, and never writes or leaks provider data", async () => {
  const routes = ["GET /account-info/v3/details", "GET /crm/v3/objects/emails", "POST /crm/v3/objects/emails/search",
    "GET /crm/v3/owners/{ownerId}", "GET /crm/v4/associations/emails/contacts/labels",
    "GET /crm/v3/objects/contacts", "GET /crm/v3/objects/contacts/{recordId}", "GET /crm/v3/objects/emails/{recordId}"];
  const replies = [{ portalId: 247066159 }, { results: [] }, { results: [], total: 0 },
    { id: "97300513", email: MAILBOX, archived: false }, { results: [{ category: "HUBSPOT_DEFINED", typeId: 198 }] },
    { results: [] }, { id: approved.contactId, properties: { email: approved.sender } }];
  for (let failure = 0; failure < routes.length; failure++) {
    let calls = 0;
    const crm = new InboxHubSpot(env.HUBSPOT_TOKEN, (async (_url, init) => {
      const index = calls++;
      assert.ok(init?.method === "GET" || (index === 2 && init?.method === "POST"), "only read/search requests allowed");
      crm.lastRequest = 0; // No pacing needed for offline responses.
      return new Response(JSON.stringify(index === failure ? { message: "PRIVATE RESPONSE synthetic-token customer@example.invalid" } : replies[index]),
        { status: index === failure ? 403 : 200 });
    }) as typeof fetch);
    const result = await runOwnerDiagnostic("probe", context, dependencies({ crm: () => crm }));
    assert.equal(result.code, "hubspot-http-403");
    assert.equal(result.hubspotRequest, routes[failure]);
    assert.equal(calls, failure + 1, "no retries or subsequent endpoints after denial");
    assert.equal(result.writeVerified, false);
    for (const secret of [env.HUBSPOT_TOKEN, "PRIVATE RESPONSE", "customer@example.invalid", approved.contactId, approved.nativeEmailId]) {
      assert.ok(!JSON.stringify(result).includes(secret));
    }
  }
});

test("API errors strip identifiers, query strings, unknown routes/methods and network error text", async () => {
  for (const [path, method, expected] of [
    ["/crm/v3/objects/contacts/private%40example.invalid?token=SECRET", "GET", "GET /crm/v3/objects/contacts/{recordId}"],
    ["/unknown/SECRET?email=private", "GET", "unclassified-hubspot-request"],
    ["/crm/v3/objects/emails", "SECRET", "unclassified-hubspot-request"],
  ]) {
    const crm = new InboxHubSpot("SECRET", (async () => { throw Error("SECRET private provider text"); }) as typeof fetch);
    await assert.rejects(crm.call(path, method), (error: unknown) => {
      assert.ok(error instanceof InboxApiError);
      assert.equal(error.status, 0); assert.equal(error.request, expected);
      assert.ok(!JSON.stringify(error).includes("SECRET"));
      assert.equal(error.message, "hubspot-http-network");
      return true;
    });
  }
});
async function database(fn: (read: Read, db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(readFileSync("migrations/018_inbox_sync.sql", "utf8"));
  const read: Read = async (sql, values = []) => (await db.query(sql, [...values])).rows as Record<string, unknown>[];
  try { await fn(read, db); } finally { await db.close(); }
}

test("diagnostic probe works while sync OFF without an activation attestation and returns only proof", async () => {
  assert.deepEqual(diagnosticConfiguration(env), { password: env.SMTP_PASSWORD, token: env.HUBSPOT_TOKEN });
  const result = await runOwnerDiagnostic("probe", context, dependencies());
  assert.equal(result.ok, true); assert.equal(result.writeVerified, false); assert.equal(result.customerRecoveries, 0);
  assert.equal(result.proof?.sourceGmailId, approved.gmailHex); assert.equal(result.proof?.readOnly, true);
  assert.equal(result.proof?.sourceNativeEmailId, approved.nativeEmailId);
  assert.equal(result.proof?.ownerContactId, approved.contactId);
  const output = JSON.stringify(result);
  for (const forbidden of [env.SMTP_PASSWORD, env.HUBSPOT_TOKEN, source().text, source().html]) assert.ok(!output.includes(forbidden));
  assert.equal(Object.hasOwn(env, "P5_INBOX_SYNC_VERIFIED_BINDING"), false);
});

test("approved native source reports all existing associations as baseline without requiring exclusive owner context", async () => {
  const associations = { contacts: { results: [{ id: approved.contactId }, { id: "internal-recipient" }] },
    companies: { results: [{ id: "owner-company" }, { id: "internal-company" }], paging: { next: {} } },
    deals: { results: [{ id: "existing-qa-deal" }] } };
  const result = await runOwnerDiagnostic("probe", context, dependencies({ crm: () => fixtureCrm({
    readExisting: async () => ({ id: approved.nativeEmailId, associations }),
  }) }));
  assert.equal(result.ok, true); assert.equal(result.writeVerified, false);
  assert.deepEqual(result.proof?.nativeAssociationBaseline, {
    contacts: { ids: [approved.contactId, "internal-recipient"].sort(), incomplete: false },
    companies: { ids: ["internal-company", "owner-company"], incomplete: true },
    deals: { ids: ["existing-qa-deal"], incomplete: false },
  });
  const copy = diagnosticCopy(source());
  assert.equal(copy.messageId, approved.copyRfc); // The baseline never becomes copy associations.
});

test("unauthorized, inactive, manager and wrong-origin requests cannot reach config, mailbox or CRM", async () => {
  let calls = 0;
  const deps = dependencies({ crm: () => { calls++; return fixtureCrm(); }, source: async () => { calls++; throw Error("not reached"); } });
  for (const invalid of [null, { ...actor, role: "manager" }, { ...actor, isActive: false }, { ...actor, id: 0 }]) {
    assert.equal((await runOwnerDiagnostic("probe", { actor: invalid, origin }, deps)).ok, false);
  }
  for (const wrong of [null, "https://attacker.invalid", "https://workspace.replit.dev"]) {
    assert.equal((await runOwnerDiagnostic("write", { actor, origin: wrong, confirmed: true }, deps)).ok, false);
  }
  assert.equal((await runOwnerDiagnostic("write", { actor, origin, confirmed: false }, deps)).code, "diagnostic-confirmation-required");
  assert.equal(calls, 0);
});

test("enabled bulk sync, wrong mailbox and missing credentials refuse diagnostics before provider access", async () => {
  let calls = 0;
  for (const invalid of [{ ...env, P5_INBOX_SYNC_ENABLED: "true" }, { ...env, SMTP_USER: "other@example.invalid" },
    { ...env, SMTP_HOST: "other.invalid" }, { ...env, HUBSPOT_TOKEN: "" }]) {
    const result = await runOwnerDiagnostic("probe", context, dependencies({ env: invalid, crm: () => { calls++; return fixtureCrm(); } }));
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test("permission, portal, contact and native body/association failures cannot authorize a diagnostic POST", async () => {
  let creates = 0;
  const cases = [
    { preflight: async () => { throw new InboxApiError(403); } },
    { preflight: async () => { throw Error("wrong-hubspot-portal"); } },
    { call: async () => ({ id: approved.contactId, properties: { email: "customer@example.invalid" } }) },
    { call: async () => { throw new InboxApiError(404); } },
    { readExisting: async () => { throw Error("crm-body-conflict"); } },
    { readExisting: async () => ({ id: approved.nativeEmailId, associations: { contacts: { results: [{ id: "other" }] } } }) },
  ];
  for (const change of cases) {
    const result = await runOwnerDiagnostic("write", context, dependencies({ crm: () => fixtureCrm({ ...change, createEmail: async () => { creates++; return "bad"; } }) }));
    assert.equal(result.ok, false); assert.equal(result.writeVerified, false);
  }
  assert.equal(creates, 0);
});

test("ordinary messages and every changed approved identity field refuse before receipt or creation", async () => {
  let writes = 0;
  const changes: Partial<Mail>[] = [
    { messageId: "<other@example.invalid>" }, { subject: "Ordinary customer request" }, { sentAt: "2026-10-08T16:23:06.000Z" },
    { from: [{ email: "customer@example.invalid", name: "Customer" }] }, { to: [{ email: "hello@boisecabinet.co", name: "Cabinet" }] },
    { cc: [{ email: "customer@example.invalid", name: "Customer" }] }, { labels: ["\\Junk"] }, { labels: ["\\Trash"] },
    { attachments: [{ name: "customer.pdf", size: 10, type: "application/pdf" }] }, { text: "", html: "" },
  ];
  for (const changed of changes) {
    const result = await runOwnerDiagnostic("write", context, dependencies({ source: async () => ({ mail: source(changed), uid: 42, uidValidity: "1" }),
      read: async () => { writes++; return []; } }));
    assert.equal(result.code, "diagnostic-source-not-approved");
  }
  assert.equal(writes, 0);
});

test("diagnostic copy is explicitly labeled, uses a distinct RFC, and preserves the approved original", () => {
  const original = source(), before = JSON.stringify(original), copy = diagnosticCopy(original);
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(copy.messageId, original.messageId); assert.equal(copy.messageId, approved.copyRfc);
  assert.match(copy.subject, /diagnostic copy/); assert.match(copy.text, /No email was sent/);
  assert.ok(copy.text.endsWith(original.text)); assert.ok(copy.html.endsWith(original.html));
  assert.ok(copy.text.includes(original.messageId));
});

test("single diagnostic has strict owner association and replay verifies saved ID without another POST", async () => database(async (read, db) => {
  let creates = 0, verifies = 0, searches = 0;
  const crm = fixtureCrm({ findEmail: async () => { searches++; return null; },
    createEmail: async (copy: Mail, contact: string, id: string) => {
      creates++; assert.equal(contact, approved.contactId); assert.equal(id, approved.gmailId); assert.equal(copy.messageId, approved.copyRfc); return "created";
    }, verify: async (id: string, copy: Mail, contact: string, gmailId: string) => {
      verifies++; assert.equal(id, "created"); assert.equal(copy.messageId, approved.copyRfc); assert.equal(contact, approved.contactId); assert.equal(gmailId, approved.gmailId);
    } });
  const deps = dependencies({ read, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).writeVerified, true);
  assert.equal((await runOwnerDiagnostic("write", context, deps)).writeVerified, true);
  assert.equal(creates, 1); assert.equal(verifies, 2); assert.equal(searches, 1);
  assert.equal((await db.query("SELECT * FROM p5_inbox_cursor")).rows.length, 0);
  const [receipt] = (await read("SELECT * FROM p5_inbox_message"));
  assert.equal(receipt.reason, approved.reason); assert.equal(receipt.status, "synced"); assert.ok(receipt.create_attempted_at);
}));

test("concurrent administrator clicks cannot perform a second diagnostic POST", async () => database(async read => {
  let release!: () => void, started!: () => void, creates = 0;
  const reached = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const crm = fixtureCrm({ createEmail: async () => { creates++; started(); await gate; return "created"; } });
  const deps = dependencies({ read, crm: () => crm });
  const first = runOwnerDiagnostic("write", context, deps);
  await reached;
  const second = await runOwnerDiagnostic("write", context, deps);
  assert.equal(second.ok, false); assert.equal(second.code, "diagnostic-busy-or-receipt-conflict");
  release(); assert.equal((await first).writeVerified, true); assert.equal(creates, 1);
}));

test("lost response and negative searches keep durable intent and never re-POST or enter the normal queue", async () => database(async read => {
  let creates = 0;
  const crm = fixtureCrm({ createEmail: async () => { creates++; throw new InboxApiError(0); } });
  const deps = dependencies({ read, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).writeVerified, false);
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "diagnostic-uncertain-no-repost");
  assert.equal(creates, 1);
  const store = new InboxStore(read, async () => { throw Error("unused"); });
  assert.equal(await store.claim(new Date(Date.now() + 86400_000)), null);
  const [receipt] = await read("SELECT * FROM p5_inbox_message");
  assert.ok(receipt.create_attempted_at); assert.equal(receipt.status, "uncertain");
}));

test("saved provider ID survives failed strict readback and is verified directly on retry", async () => database(async read => {
  let creates = 0, verifies = 0, searches = 0;
  const crm = fixtureCrm({ createEmail: async () => { creates++; return "saved-id"; }, findEmail: async () => { searches++; return null; },
    verify: async () => { if (++verifies === 1) throw Error("created-email-contact-mismatch"); } });
  const deps = dependencies({ read, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "created-email-contact-mismatch");
  assert.equal((await runOwnerDiagnostic("write", context, deps)).writeVerified, true);
  assert.equal(creates, 1); assert.equal(searches, 1); assert.equal(verifies, 2);
}));

test("existing copy without a local write intent never claims this runtime proved EMAIL creation", async () => database(async read => {
  let creates = 0;
  const crm = fixtureCrm({ findEmail: async () => ({ id: "preexisting-copy" }), createEmail: async () => { creates++; return "wrong"; } });
  const deps = dependencies({ read, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "diagnostic-existing-copy-no-local-write-proof");
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "diagnostic-review-required");
  assert.equal(creates, 0);
}));

test("positive or ambiguous copy search followed by failed read cannot permit a later negative search to POST", async () => database(async read => {
  let searches = 0, creates = 0;
  const crm = fixtureCrm({ findEmail: async () => { if (++searches === 1) throw Error("crm-body-conflict"); return null; },
    createEmail: async () => { creates++; return "wrong"; } });
  const deps = dependencies({ read, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "crm-body-conflict");
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "diagnostic-review-required");
  assert.equal(creates, 0); assert.equal(searches, 1);
}));

test("durable search fence prevents creation after a crash or database failure before positive evidence is saved", async () => database(async read => {
  let creates = 0, searches = 0, failReview = true;
  const flakyRead: Read = async (sql, values) => {
    if (failReview && sql.includes("SET status=$4,lease_token=NULL")) throw Error("synthetic database interruption");
    return read(sql, values);
  };
  const crm = fixtureCrm({ findEmail: async () => { searches++; throw Error("crm-body-conflict"); },
    createEmail: async () => { creates++; return "wrong"; } });
  const deps = dependencies({ read: flakyRead, crm: () => crm });
  assert.equal((await runOwnerDiagnostic("write", context, deps)).ok, false);
  const [interrupted] = await read("SELECT * FROM p5_inbox_message");
  assert.equal(interrupted.create_attempted_at, null);
  assert.ok((interrupted.locations as { diagnosticSearchFence?: boolean }[]).some(x => x.diagnosticSearchFence));
  await read("UPDATE p5_inbox_message SET lease_until=now()-interval '1 second'");
  failReview = false;
  assert.equal((await runOwnerDiagnostic("write", context, deps)).code, "diagnostic-search-uncertain-no-post");
  assert.equal(creates, 0); assert.equal(searches, 1);
}));

test("IMAP diagnostic selects exactly the approved Gmail ID, EXAMINEs, fetches by UID and never advances cursors", async () => {
  const raw = Buffer.from([`From: Owner <${approved.sender}>`, `To: ${MAILBOX}`, `Subject: ${approved.subject}`, `Message-ID: ${approved.rfc}`,
    "Date: Thu, 08 Oct 2026 16:23:05 +0000", "Content-Type: text/plain; charset=utf-8", "", "Offline diagnostic fixture."].join("\r\n"));
  const calls: string[] = [];
  let providerId = approved.gmailId;
  const fake = { capabilities: new Map([["X-GM-EXT-1", true]]), usable: true, mailbox: { readOnly: true, uidValidity: BigInt(3) },
    on: () => {}, connect: async () => {}, close: () => { calls.push("close"); }, logout: async () => { calls.push("logout"); },
    list: async () => ["\\All", "\\Junk", "\\Trash"].map((use, i) => ({ path: `Localized-${i}`, flags: new Set([use]), specialUse: use, specialUseSource: "extension" })),
    getMailboxLock: async (path: string, options: { readOnly: boolean }) => { assert.equal(path, "Localized-0"); assert.equal(options.readOnly, true); return { release: () => calls.push("release") }; },
    search: async (query: { emailId: string }, options: { uid: boolean }) => { assert.equal(query.emailId, approved.gmailId); assert.equal(options.uid, true); return [42]; },
    fetchOne: async (uid: number, fields: { source?: boolean }, options: { uid: boolean }) => {
      assert.equal(uid, 42); assert.equal(options.uid, true); calls.push(fields.source ? "source" : "metadata");
      return fields.source ? { source: raw } : { emailId: providerId, size: raw.length, internalDate: new Date(approved.sentAt), labels: new Set(), flags: new Set() };
    },
  } as unknown as ImapFlow;
  const result = await readOwnerSource("synthetic-password", Date.now() + 5000, options => { assert.equal(options.host, "imap.gmail.com"); assert.equal(options.logRaw, false); return fake; });
  assert.equal(result.mail.messageId, approved.rfc); assert.equal(result.uidValidity, "3");
  assert.deepEqual(calls, ["metadata", "source", "release", "logout"]);
  calls.length = 0; providerId = "999999999999999999";
  await assert.rejects(() => readOwnerSource("synthetic-password", Date.now() + 5000, () => fake), /source-not-approved/);
  assert.deepEqual(calls, ["metadata", "release", "logout"]);
});

test("IMAP diagnostic deadline closes a stalled connection without source or mailbox operations", async () => {
  let reject!: (error: Error) => void, closes = 0;
  const fake = { usable: false, on: () => {}, connect: () => new Promise((_resolve, fail) => { reject = fail; }),
    close: () => { closes++; reject(new Error("synthetic timeout")); } } as unknown as ImapFlow;
  await assert.rejects(() => readOwnerSource("synthetic-password", Date.now() + 10, () => fake), /synthetic timeout/);
  assert.ok(closes >= 1);
});
