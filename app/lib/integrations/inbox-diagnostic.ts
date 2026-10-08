import { createHash, randomUUID } from "node:crypto";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { MAILBOX, PORTAL, MAX_SOURCE_BYTES, parseMail, type Mail } from "./inbox-policy.ts";
import { InboxApiError, InboxHubSpot } from "./inbox-hubspot.ts";
import { InboxStore, type Read, type Receipt } from "./inbox-store.ts";
import { inboxFolders } from "./inbox-sync.ts";

// Explicitly approved owner-only source. No browser-supplied source, contact,
// credential, recipient, or content can select a different operation.
export const OWNER_DIAGNOSTIC = Object.freeze({
  gmailHex: "1a11c535bd394396",
  gmailId: BigInt("0x1a11c535bd394396").toString(),
  rfc: "<CABD3FGwvNz51ss3mqV7+7HvP4aysZPuD0f_gyiq9B9gA2kW4PA@mail.gmail.com>",
  subject: "[Delivery test] P5HSAUTO20261008162302Z hello@p5homeco.com",
  sentAt: "2026-10-08T16:23:05.000Z", sender: "hello@webiq.co",
  contactId: "566594721482", nativeEmailId: "405857171192",
  receiptId: "owner-diagnostic:1a11c535bd394396",
  copyRfc: "<p5-owner-connection-test-247066159-1a11c535bd394396@p5homeco.invalid>",
  reason: "owner-connection-diagnostic",
});
type Env = Record<string, string | undefined>;
type Actor = { id: number; role: string; isActive: boolean } | null;
export type DiagnosticProof = {
  checkedAt: string; mailbox: string; portal: number; sourceGmailId: string;
  sourceRfc: string; sourceNativeEmailId: string; sourceSha256: string;
  ownerContactId: string; uidValidity: string; uid: number; readOnly: true;
  emailRead: true; originalBodyMatched: true; syncEnabled: false;
  nativeAssociationBaseline: Record<string, { ids: string[]; incomplete: boolean }>;
};
export type DiagnosticResult = { ok: boolean; code: string; proof?: DiagnosticProof;
  diagnosticEmailId?: string; diagnosticRfc?: string; writeVerified?: boolean; customerRecoveries: 0 };

export function authorizeDiagnostic(actor: Actor, origin: string | null) {
  if (!actor?.isActive || actor.role !== "administrator" || !Number.isSafeInteger(actor.id) || actor.id <= 0) throw new Error("diagnostic-admin-required");
  if (origin !== "https://p5homeco.com") throw new Error("diagnostic-production-origin-required");
  return actor.id;
}
export function diagnosticConfiguration(env: Env) {
  if (env.P5_INBOX_SYNC_ENABLED === "true") throw new Error("diagnostic-requires-sync-off");
  if (env.SMTP_USER?.trim().toLowerCase() !== MAILBOX || (env.SMTP_HOST || "smtp.gmail.com") !== "smtp.gmail.com") throw new Error("diagnostic-wrong-mailbox-provider");
  if (!env.SMTP_PASSWORD || !env.HUBSPOT_TOKEN) throw new Error("diagnostic-missing-credentials");
  // Deliberately independent of VERIFIED_BINDING and START_AT: this obtains
  // evidence required BEFORE those activation gates can truthfully be set.
  return { password: env.SMTP_PASSWORD, token: env.HUBSPOT_TOKEN };
}
export function assertOwnerSource(mail: Mail) {
  const a = OWNER_DIAGNOSTIC;
  if (mail.messageId !== a.rfc || mail.subject !== a.subject || mail.sentAt !== a.sentAt
    || mail.from.length !== 1 || mail.from[0].email !== a.sender
    || mail.to.length !== 1 || mail.to[0].email !== MAILBOX || mail.cc.length || (mail.bcc || []).length
    || mail.labels.some(label => ["\\Junk", "\\Spam", "\\Trash", "\\Draft"].includes(label))
    || (!mail.text && !mail.html) || mail.text.length > 100_000 || mail.html.length > 100_000 || mail.attachments.length) {
    throw new Error("diagnostic-source-not-approved");
  }
}
export async function readOwnerSource(password: string, deadline: number,
  makeClient: (options: ImapFlowOptions) => ImapFlow = options => new ImapFlow(options)) {
  const client = makeClient({ host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: MAILBOX, pass: password }, logger: false, logRaw: false, emitLogs: false,
    disableAutoIdle: true, connectionTimeout: 12_000, greetingTimeout: 12_000, socketTimeout: 15_000,
    tls: { rejectUnauthorized: true } });
  client.on("error", () => {});
  const timer = setTimeout(() => client.close(), Math.max(1, deadline - Date.now()));
  try {
    await client.connect();
    if (!client.capabilities.has("X-GM-EXT-1")) throw new Error("diagnostic-gmail-unverified");
    const folder = inboxFolders(await client.list()).find(f => f.use === "\\All")!;
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      if (!client.mailbox || !client.mailbox.readOnly) throw new Error("diagnostic-mailbox-not-read-only");
      const uids = await client.search({ emailId: OWNER_DIAGNOSTIC.gmailId }, { uid: true });
      if (!uids || uids.length !== 1) throw new Error("diagnostic-source-not-found");
      const metadata = await client.fetchOne(uids[0], { uid: true, emailId: true, size: true, internalDate: true, labels: true, flags: true }, { uid: true });
      if (!metadata || metadata.emailId !== OWNER_DIAGNOSTIC.gmailId || !metadata.size || metadata.size > MAX_SOURCE_BYTES) throw new Error("diagnostic-source-not-approved");
      const received = new Date(metadata.internalDate || "");
      if (!Number.isFinite(received.getTime())) throw new Error("diagnostic-source-not-approved");
      const fetched = await client.fetchOne(uids[0], { source: true }, { uid: true });
      if (!fetched || !fetched.source) throw new Error("diagnostic-source-not-found");
      const mail = await parseMail(fetched.source, received, [...new Set([...(metadata.labels || []), ...(metadata.flags || []), "\\All"])]);
      assertOwnerSource(mail);
      return { mail, uid: uids[0], uidValidity: client.mailbox.uidValidity.toString() };
    } finally { lock.release(); }
  } finally {
    try { if (client.usable) await client.logout().catch(() => client.close()); else client.close(); }
    finally { clearTimeout(timer); }
  }
}
export function diagnosticCopy(source: Mail): Mail {
  assertOwnerSource(source);
  const notice = "P5 connection test: synthetic diagnostic copy of an approved owner-only source. No email was sent. This is not a customer recovery.";
  const reference = `Original source RFC Message-ID: ${OWNER_DIAGNOSTIC.rfc}`;
  return { ...source, messageId: OWNER_DIAGNOSTIC.copyRfc,
    subject: "[P5 connection test — diagnostic copy] " + source.subject,
    text: `${notice}\n${reference}\n\n--- Original owner diagnostic body ---\n${source.text}`,
    html: source.html ? `<p>${notice}</p><p>Original source RFC Message-ID: ${OWNER_DIAGNOSTIC.rfc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><hr>${source.html}` : "",
  };
}
function mailFingerprint(mail: Mail) {
  const addresses = (items: Mail["from"]) => items.map(a => [a.email, a.name]);
  // JSONB key order and mutable read/unread labels are not source identity.
  return createHash("sha256").update(JSON.stringify([mail.messageId, mail.subject, mail.sentAt, mail.receivedAt,
    addresses(mail.from), addresses(mail.to), addresses(mail.cc), addresses(mail.bcc || []), mail.text, mail.html,
    mail.headers.map(h => [h.key, h.line]), mail.attachments.map(a => [a.name, a.size, a.type])])).digest("hex");
}
function errorCode(error: unknown) {
  if (error instanceof InboxApiError) return `hubspot-http-${error.status || "network"}`;
  const code = error instanceof Error ? error.message : "";
  return new Set(["diagnostic-admin-required", "diagnostic-production-origin-required", "diagnostic-requires-sync-off", "diagnostic-wrong-mailbox-provider",
    "diagnostic-missing-credentials", "diagnostic-source-not-approved", "diagnostic-gmail-unverified", "diagnostic-mailbox-not-read-only",
    "diagnostic-source-not-found", "diagnostic-owner-contact-mismatch", "diagnostic-native-association-mismatch", "diagnostic-confirmation-required",
    "diagnostic-receipt-conflict", "wrong-hubspot-portal", "wrong-hubspot-owner", "email-association-unverified", "duplicate-crm-rfc-id",
    "crm-source-conflict", "crm-header-conflict", "crm-body-conflict", "created-email-readback-mismatch", "created-email-header-mismatch",
    "created-email-contact-mismatch", "unexpected-email-association", "inbox-pass-budget-ended"]).has(code) ? code : "diagnostic-check-failed";
}
export type DiagnosticDependencies = {
  env: Env; read: Read; crm: (token: string, deadline: number) => InboxHubSpot;
  source: (password: string, deadline: number) => ReturnType<typeof readOwnerSource>;
};
export async function runOwnerDiagnostic(mode: "probe" | "write", context: { actor: Actor; origin: string | null; confirmed?: boolean }, deps: DiagnosticDependencies): Promise<DiagnosticResult> {
  let proof: DiagnosticProof | undefined;
  const result = (ok: boolean, code: string, extra: Partial<DiagnosticResult> = {}): DiagnosticResult => ({ ok, code, ...(proof ? { proof } : {}),
    ...(mode === "write" ? { diagnosticRfc: OWNER_DIAGNOSTIC.copyRfc } : {}), customerRecoveries: 0, ...extra });
  try {
    const actorId = authorizeDiagnostic(context.actor, context.origin);
    if (mode === "write" && context.confirmed !== true) throw new Error("diagnostic-confirmation-required");
    const config = diagnosticConfiguration(deps.env), deadline = Date.now() + 75_000;
    const crm = deps.crm(config.token, deadline);
    await crm.preflight();
    const contact = await crm.call<{ id: string; archived?: boolean; properties: { email: string } }>(`/crm/v3/objects/contacts/${OWNER_DIAGNOSTIC.contactId}?properties=email`);
    if (contact.id !== OWNER_DIAGNOSTIC.contactId || contact.archived || contact.properties.email?.toLowerCase() !== OWNER_DIAGNOSTIC.sender) throw new Error("diagnostic-owner-contact-mismatch");
    const source = await deps.source(config.password, Math.min(deadline, Date.now() + 40_000));
    assertOwnerSource(source.mail);
    const native = await crm.readExisting(OWNER_DIAGNOSTIC.nativeEmailId, source.mail);
    if (native.id !== OWNER_DIAGNOSTIC.nativeEmailId
      || !native.associations?.contacts?.results.some(contact => contact.id === OWNER_DIAGNOSTIC.contactId)) throw new Error("diagnostic-native-association-mismatch");
    // Native logging already attached internal recipient/QA context to this
    // fixed source. Membership proves the approved owner context; it is not
    // exclusive-owner proof and never licenses copying other associations.
    const nativeAssociationBaseline = Object.fromEntries(Object.entries(native.associations || {}).map(([kind, data]) =>
      [kind, { ids: [...new Set(data.results.map(item => item.id))].sort(), incomplete: Boolean(data.paging) }]));
    proof = { checkedAt: new Date().toISOString(), mailbox: MAILBOX, portal: PORTAL, sourceGmailId: OWNER_DIAGNOSTIC.gmailHex,
      sourceRfc: OWNER_DIAGNOSTIC.rfc, sourceNativeEmailId: native.id, sourceSha256: mailFingerprint(source.mail),
      ownerContactId: OWNER_DIAGNOSTIC.contactId, uidValidity: source.uidValidity, uid: source.uid,
      readOnly: true, emailRead: true, originalBodyMatched: true, syncEnabled: false, nativeAssociationBaseline };
    if (mode === "probe") return result(true, "production-binding-read-verified", { writeVerified: false });

    const copy = diagnosticCopy(source.mail), now = new Date();
    // An isolated receipt: no folder cursor, general claim, customer/contact
    // creation, or recovery count. Its deterministic RFC is distinct from the
    // already-logged native source and is searched before this one test POST.
    await deps.read(`INSERT INTO p5_inbox_message(mailbox,source_id,rfc_id,payload,labels,locations,status,reason,identity,next_attempt_at)
      VALUES($1,$2,$3,$4::jsonb,'[]'::jsonb,$5::jsonb,'pending',$6,NULL,$7) ON CONFLICT DO NOTHING`,
    [MAILBOX, OWNER_DIAGNOSTIC.receiptId, copy.messageId, JSON.stringify(copy), JSON.stringify([{ diagnostic: true, actorId, sourceGmailId: OWNER_DIAGNOSTIC.gmailId }]), OWNER_DIAGNOSTIC.reason, now]);
    const token = randomUUID();
    const [claimed] = await deps.read(`UPDATE p5_inbox_message SET status='processing',lease_token=$4,lease_until=$5,attempts=attempts+1
      WHERE mailbox=$1 AND source_id=$2 AND reason=$3 AND status<>'review' AND (lease_until IS NULL OR lease_until<=$6)
      RETURNING *`, [MAILBOX, OWNER_DIAGNOSTIC.receiptId, OWNER_DIAGNOSTIC.reason, token, new Date(now.getTime() + 120_000), now]);
    if (!claimed) {
      const [saved] = await deps.read(`SELECT status FROM p5_inbox_message WHERE mailbox=$1 AND source_id=$2 AND reason=$3`, [MAILBOX, OWNER_DIAGNOSTIC.receiptId, OWNER_DIAGNOSTIC.reason]);
      return result(false, saved?.status === "review" ? "diagnostic-review-required" : "diagnostic-busy-or-receipt-conflict");
    }
    const row = claimed as unknown as Receipt;
    const store = new InboxStore(deps.read, async () => { throw new Error("diagnostic-no-cursor-transaction"); });
    let id = row.hubspot_email_id || undefined;
    let attempted = Boolean(row.create_attempted_at);
    try {
      if (mailFingerprint(row.payload) !== mailFingerprint(copy) || (claimed.rfc_id !== copy.messageId)) throw new Error("diagnostic-receipt-conflict");
      if (!id && !attempted) {
        // Persist before the first copy search, not after positive evidence.
        // A crash or failed receipt write after search can never let a later
        // negative result authorize creation. Only this first claimant may
        // continue to a POST, whose distinct create intent is saved below.
        const fenced = await deps.read(`UPDATE p5_inbox_message SET locations=locations || '[{"diagnosticSearchFence":true}]'::jsonb
          WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND lease_until>$4 AND status='processing'
          AND NOT locations @> '[{"diagnosticSearchFence":true}]'::jsonb RETURNING source_id`,
        [MAILBOX, OWNER_DIAGNOSTIC.receiptId, row.lease_token, new Date()]);
        if (!fenced.length) {
          await store.finish(row, "review", new Date(), { error: "diagnostic-search-uncertain-no-post" });
          return result(false, "diagnostic-search-uncertain-no-post", { writeVerified: false });
        }
      }
      if (!id) id = (await crm.findEmail(copy))?.id;
      if (id && !row.create_attempted_at) {
        await store.finish(row, "review", new Date(), { emailId: id, origin: "existing", error: "diagnostic-existing-copy-no-local-write-proof" });
        return result(false, "diagnostic-existing-copy-no-local-write-proof", { diagnosticEmailId: id, writeVerified: false });
      }
      if (!id && row.create_attempted_at) {
        await store.finish(row, "uncertain", now, { error: "diagnostic-uncertain-no-repost" });
        return result(false, "diagnostic-uncertain-no-repost", { writeVerified: false });
      }
      if (!id) {
        if (!await store.intent(row, new Date())) return result(false, "diagnostic-claim-expired");
        attempted = true;
        id = await crm.createEmail(copy, OWNER_DIAGNOSTIC.contactId, OWNER_DIAGNOSTIC.gmailId);
      }
      await store.finish(row, "uncertain", new Date(), { emailId: id, contactId: OWNER_DIAGNOSTIC.contactId, origin: "created" });
      await crm.verify(id, copy, OWNER_DIAGNOSTIC.contactId, OWNER_DIAGNOSTIC.gmailId);
      await deps.read(`UPDATE p5_inbox_message SET status='synced',last_error=NULL WHERE mailbox=$1 AND source_id=$2 AND hubspot_email_id=$3`, [MAILBOX, OWNER_DIAGNOSTIC.receiptId, id]);
      return result(true, "owner-diagnostic-write-verified", { diagnosticEmailId: id, writeVerified: true });
    } catch (error) {
      const code = errorCode(error);
      if (id) await deps.read(`UPDATE p5_inbox_message SET status='uncertain',last_error=$4 WHERE mailbox=$1 AND source_id=$2 AND hubspot_email_id=$3`, [MAILBOX, OWNER_DIAGNOSTIC.receiptId, id, code]);
      // A failed/conflicting search may already have observed an existing
      // copy before its full read failed. Without a prior create intent,
      // retain a terminal review hold; a later negative search cannot POST.
      else await store.finish(row, attempted ? "uncertain" : "review", new Date(), { error: code });
      return result(false, code, { ...(id ? { diagnosticEmailId: id } : {}), writeVerified: false });
    }
  } catch (error) { return result(false, errorCode(error), { writeVerified: false }); }
}
