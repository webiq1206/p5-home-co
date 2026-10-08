import { ImapFlow, type ListResponse, type ImapFlowOptions } from "imapflow";
import { getPool, transaction } from "../db.ts";
import { MAILBOX, PORTAL, MAX_SOURCE_BYTES, VERIFIED_HELLO_ALIASES, email, ourAddress, parseMail, classify, type Mail } from "./inbox-policy.ts";
import { InboxStore, type Receipt, type Read } from "./inbox-store.ts";
import { InboxApiError, InboxHubSpot } from "./inbox-hubspot.ts";

type Environment = Record<string, string | undefined>;
export function inboxConfiguration(env: Environment) {
  if (env.P5_INBOX_SYNC_ENABLED !== "true") return null;
  // This non-secret attestation may only be set after production binding and
  // an authorized EMAIL create/readback test have actually been verified.
  if (env.P5_INBOX_SYNC_VERIFIED_BINDING !== `${PORTAL}:${MAILBOX}`) throw new Error("production-and-email-write-not-verified");
  if (env.SMTP_USER?.trim().toLowerCase() !== MAILBOX || (env.SMTP_HOST || "smtp.gmail.com") !== "smtp.gmail.com") throw new Error("wrong-mailbox-provider");
  if (!env.SMTP_PASSWORD || !env.HUBSPOT_TOKEN) throw new Error("missing-existing-credentials");
  const start = new Date(env.P5_INBOX_SYNC_START_AT || "");
  if (!Number.isFinite(start.getTime()) || !/Z$/.test(env.P5_INBOX_SYNC_START_AT || "")) throw new Error("explicit-utc-start-required");
  return { start, password: env.SMTP_PASSWORD, token: env.HUBSPOT_TOKEN };
}
export function inboxFolders(folders: Pick<ListResponse, "path" | "flags" | "specialUse" | "specialUseSource">[]) {
  return ["\\All", "\\Junk", "\\Trash"].map(use => {
    const matches = folders.filter(f => !f.flags.has("\\Noselect") && (f.flags.has(use) || (f.specialUse === use && f.specialUseSource === "extension")));
    if (matches.length !== 1) throw new Error("gmail-special-use-folders-unverified");
    return { path: matches[0].path, use };
  });
}
function errorCode(error: unknown) {
  // Only our fixed codes are persisted. Provider bodies can contain personal
  // information; transport errors can contain connection details.
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9-]{1,80}$/.test(message) ? message : "inbox-operation-failed";
}
async function preserveExisting(store: InboxStore, crm: InboxHubSpot, row: Receipt,
  record: NonNullable<Awaited<ReturnType<InboxHubSpot["findEmail"]>>>, now: Date) {
  // Persist positive evidence before any further network call. A failed
  // customer lookup must never allow a later negative search to create again.
  if (!await store.adoptExisting(row, record.id)) return;
  let expected: string | null = null;
  if (row.identity) {
    try { expected = await crm.findContact({ ...row.identity, create: false }); }
    catch (error) {
      if (!["ambiguous-contact", "contact-search-incomplete"].includes(errorCode(error))) throw error;
    }
  }
  const association = record.associations?.contacts;
  const contacts = [...new Set(association?.results.map(x => x.id) || [])];
  let verified = Boolean(expected && contacts.includes(expected) && !Object.values(record.associations || {}).some(data => data.paging));
  const internalContacts: { id: string; email: string }[] = [];
  const envelope = [...row.payload.from, ...row.payload.to, ...row.payload.cc, ...(row.payload.bcc || [])].map(a => a.email);
  const allowedInternal = new Set(envelope.filter(address => email(address) && ourAddress(address)));
  if (envelope.some(address => VERIFIED_HELLO_ALIASES.includes(address))) allowedInternal.add(MAILBOX);
  if (verified) for (const id of contacts.filter(id => id !== expected)) {
    const contact = await crm.call<{ id: string; archived?: boolean; properties: { email?: string } }>(`/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=email`);
    const address = email(contact.properties.email || "");
    if (contact.id !== id || contact.archived || !address || !allowedInternal.has(address)) { verified = false; break; }
    internalContacts.push({ id, email: address });
  }
  if (verified && expected) {
    // Preserve native recipient context separately from the one independently
    // matched customer. Never create/remove native CRM associations.
    const baseline = Object.fromEntries(Object.entries(record.associations || {}).map(([kind, data]) =>
      [kind, [...new Set(data.results.map(item => item.id))].sort()]));
    await store.read(`UPDATE p5_inbox_message SET locations=(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(locations || $4::jsonb) item)
      WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND status='processing'`,
    [MAILBOX, row.source_id, row.lease_token, JSON.stringify([{ nativeAssociationContext: { emailId: record.id, customerContactId: expected, internalContacts, baseline } }])]);
    await store.finish(row, "existing", now, { emailId: record.id, contactId: expected });
  }
  else await store.finish(row, "review", now, { emailId: record.id, error: "native-email-customer-association-unverified" });
}
export async function deliverReceipt(store: InboxStore, crm: InboxHubSpot, row: Receipt, now: () => Date = () => new Date()) {
  let createdId = row.hubspot_email_id || undefined;
  let contactId: string | null = null;
  let attempted = Boolean(row.create_attempted_at);
  try {
    // Saved create response survives failed verification. Never create again.
    if (createdId) {
      if (row.hubspot_email_origin === "existing") {
        await preserveExisting(store, crm, row, await crm.readExisting(createdId, row.payload), now());
        return;
      }
      const expected = row as Receipt & { hubspot_contact_id?: string };
      await crm.verify(createdId, row.payload, expected.hubspot_contact_id || null, row.source_id);
      await store.finish(row, "synced", now(), { emailId: createdId });
      return;
    }
    const existing = await crm.findEmail(row.payload);
    if (existing) {
      await preserveExisting(store, crm, row, existing, now());
      return;
    }
    if (attempted) {
      // Search may lag indefinitely or omit archived records. A negative
      // result cannot authorize another POST after an uncertain response.
      await store.finish(row, "uncertain", now(), { error: "create-uncertain-no-automatic-repost" });
      return;
    }
    if (row.identity) {
      try { contactId = await crm.findContact(row.identity); }
      catch (error) {
        if (!["ambiguous-contact", "contact-search-incomplete"].includes(errorCode(error))) throw error;
        // Preserve uncertain customer identity as an unassociated activity.
      }
    }
    // Give native Gmail logging two hours, then search and read again directly
    // before the durable create intent. No existing CRM record is modified.
    const raced = await crm.findEmail(row.payload);
    if (raced) { await preserveExisting(store, crm, row, raced, now()); return; }
    if (!await store.intent(row, now())) return;
    attempted = true;
    createdId = await crm.createEmail(row.payload, contactId, row.source_id);
    // Save provider ID before verification. A failed GET must not lose proof
    // of creation and must never turn into a second POST.
    await store.finish(row, "uncertain", now(), { emailId: createdId, origin: "created", ...(contactId ? { contactId } : {}) });
    await crm.verify(createdId, row.payload, contactId, row.source_id);
    // finish released the claim. Final verification uses the immutable ID.
    await store.read(`UPDATE p5_inbox_message SET status='synced',last_error=NULL
      WHERE mailbox=$1 AND source_id=$2 AND hubspot_email_id=$3 AND status='uncertain'`, [MAILBOX, row.source_id, createdId]);
  } catch (error) {
    const code = errorCode(error);
    const review = /conflict|mismatch|association|duplicate|ambiguous/.test(code) || (error instanceof InboxApiError && [400,401,403,404].includes(error.status));
    if (createdId) {
      await store.read(`UPDATE p5_inbox_message SET status=$4,last_error=$5 WHERE mailbox=$1 AND source_id=$2 AND hubspot_email_id=$3`,
        [MAILBOX, row.source_id, createdId, review ? "review" : "uncertain", code]);
    } else {
      await store.finish(row, review ? "review" : attempted ? "uncertain" : "retry", now(), { error: code });
    }
    // Stop the pass immediately on permission failure. No fallback API.
    if (error instanceof InboxApiError && [401,403].includes(error.status)) throw error;
  }
}

export async function captureMailbox(store: InboxStore, config: NonNullable<ReturnType<typeof inboxConfiguration>>, deadline: number,
  makeClient: (options: ImapFlowOptions) => ImapFlow = options => new ImapFlow(options), parse = parseMail) {
  const client = makeClient({ host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: MAILBOX, pass: config.password }, logger: false, logRaw: false, emitLogs: false,
    disableAutoIdle: true, connectionTimeout: 12_000, greetingTimeout: 12_000, socketTimeout: 15_000,
    tls: { rejectUnauthorized: true } });
  // Never print credential-bearing transport errors.
  client.on("error", () => {});
  const timer = setTimeout(() => client.close(), Math.max(1, deadline - Date.now()));
  try {
    await client.connect();
    if (!client.capabilities.has("X-GM-EXT-1")) throw new Error("not-a-gmail-mailbox");
    const folders = inboxFolders(await client.list());
    // Rotate the first folder across watchdog ticks so a large archive cannot
    // permanently starve Spam/Trash metadata retention.
    const firstFolder = Math.floor(Date.now() / 300_000) % folders.length;
    folders.push(...folders.splice(0, firstFolder));
    let captured = 0;
    for (const folder of folders) {
      if (Date.now() > deadline - 15_000) break;
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        if (!client.mailbox || !client.mailbox.readOnly) throw new Error("mailbox-not-read-only");
        const validity = client.mailbox.uidValidity.toString();
        const last = await store.cursor(folder.path, validity);
        const upper = Math.min(Number(client.mailbox.uidNext) - 1, last + 500);
        if (upper <= last) continue;
        const found = await client.search({ uid: `${last + 1}:${upper}`, since: config.start }, { uid: true });
        const ids = (found || []).filter(uid => uid > last && uid <= upper).sort((a,b) => a-b);
        let completed = 0;
        for (const uid of ids.slice(0, 20)) {
          if (Date.now() > deadline - 15_000) break;
          const metadata = await client.fetchOne(uid, { uid: true, flags: true, labels: true, size: true, internalDate: true, emailId: true, envelope: true }, { uid: true });
          if (!metadata) throw new Error("message-disappeared-retry-range");
          if (!metadata.emailId || !/^\d+$/.test(metadata.emailId)) throw new Error("gmail-source-id-unverified");
          const labels = [...new Set([...(metadata.labels || []), ...(metadata.flags || []), folder.use])];
          const received = new Date(metadata.internalDate || "");
          if (!Number.isFinite(received.getTime())) throw new Error("invalid-received-date");
          let mail: Mail, decision: ReturnType<typeof classify>;
          const addresses = (items: { address?: string; name?: string }[] | undefined) => (items || []).map(a => ({ email: a.address || "", name: a.name || "" }));
          const empty = (): Mail => ({ messageId: metadata.envelope?.messageId || "", subject: metadata.envelope?.subject || "", receivedAt: received.toISOString(), sentAt: null,
            from: addresses(metadata.envelope?.from), to: addresses(metadata.envelope?.to), cc: addresses(metadata.envelope?.cc), bcc: addresses(metadata.envelope?.bcc), text: "", html: "", headers: [], attachments: [], labels });
          if (received < config.start) {
            mail = empty(); decision = { status: "ignored", reason: "before-explicit-start" };
          } else if (!metadata.size || metadata.size > MAX_SOURCE_BYTES) {
            mail = empty();
            decision = { status: "review", reason: "oversize-source-retained-in-gmail" };
          } else {
            const full = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!full || !full.source) throw new Error("missing-message-source");
            try { mail = await parse(full.source, received, labels); decision = classify(mail); }
            catch { mail = empty(); decision = { status: "review", reason: "mime-source-retained-in-gmail" }; }
          }
          await store.capture({ sourceId: metadata.emailId, folder: folder.path, validity, uid, mail, decision }, new Date());
          captured++; completed++;
        }
        if (completed === ids.length) {
          // Only advance over UID gaps after the entire selected window has
          // been searched and each found message durably captured.
          await store.read(`INSERT INTO p5_inbox_cursor(mailbox,folder,uid_validity,last_uid) VALUES($1,$2,$3,$4)
            ON CONFLICT(mailbox,folder,uid_validity) DO UPDATE SET last_uid=GREATEST(p5_inbox_cursor.last_uid,EXCLUDED.last_uid),updated_at=now()`, [MAILBOX, folder.path, validity, upper]);
        }
      } finally { lock.release(); }
    }
    return captured;
  } finally {
    try { if (client.usable) await client.logout().catch(() => client.close()); else client.close(); }
    finally { clearTimeout(timer); }
  }
}

const boundedRead: Read = async (text, values = []) => {
  const request = { text, values: [...values], query_timeout: 10_000 };
  return (await getPool().query(request)).rows;
};
export async function runInboxSync(env: Environment = process.env) {
  if (env.P5_INBOX_SYNC_ENABLED !== "true") return { status: "disabled", captured: 0, processed: 0 };
  let captured = 0, processed = 0;
  try {
    const config = inboxConfiguration(env)!;
    const deadline = Date.now() + 90_000;
    const crm = new InboxHubSpot(config.token, fetch, deadline);
    await crm.preflight(); // Must succeed before mailbox access or checkpoint changes.
    const store = new InboxStore(boundedRead, fn => transaction(async client => {
      await client.query("SET LOCAL statement_timeout='5s'");
      return fn(async (text, values = []) => {
        const request = { text, values: [...values], query_timeout: 10_000 };
        return (await client.query(request)).rows;
      });
    }));
    captured = await captureMailbox(store, config, Math.min(deadline, Date.now() + 45_000));
    while (processed < 10 && Date.now() < deadline - 15_000) {
      const row = await store.claim(new Date());
      if (!row) break;
      await deliverReceipt(store, crm, row);
      processed++;
    }
    const [backlog] = await boundedRead(`SELECT count(*)::integer AS unresolved FROM p5_inbox_message WHERE mailbox=$1 AND reason<>'owner-connection-diagnostic' AND status IN ('review','retry','uncertain')`, [MAILBOX]);
    const unresolved = Number(backlog?.unresolved || 0);
    await boundedRead(`INSERT INTO integration_health(name,state,last_attempt_at,last_success_at,records_processed,last_error)
      VALUES('hubspot-inbox',$2,now(),now(),$1,$3) ON CONFLICT(name) DO UPDATE SET
      state=$2,last_attempt_at=now(),last_success_at=now(),records_processed=$1,last_error=$3,updated_at=now()`,
      [processed, unresolved ? "degraded" : "connected", unresolved ? `${unresolved} inbox receipts require reconciliation or review` : null]);
    return { status: "checked", captured, processed, unresolved };
  } catch (error) {
    const code = errorCode(error);
    await boundedRead(`INSERT INTO integration_health(name,state,last_attempt_at,last_error) VALUES('hubspot-inbox','failed',now(),$1)
      ON CONFLICT(name) DO UPDATE SET state='failed',last_attempt_at=now(),last_error=$1,updated_at=now()`, [code]).catch(() => undefined);
    return { status: "blocked", captured, processed, error: code };
  }
}
