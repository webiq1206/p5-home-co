import { simpleParser } from "mailparser";

export const MAILBOX = "hello@p5homeco.com";
export const PORTAL = 247066159;
export const OWNER = "97300513";
export const DOMAINS = ["p5homeco.com", "boisecabinet.co", "boiseconstruction.co", "boiseremodeling.co", "boisehandyman.co", "boiseadu.co"];
export const VERIFIED_HELLO_ALIASES = DOMAINS.map(domain => `hello@${domain}`);
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export type Address = { email: string; name: string };
export type Mail = {
  messageId: string; subject: string; receivedAt: string; sentAt: string | null;
  from: Address[]; to: Address[]; cc: Address[]; bcc?: Address[]; text: string; html: string;
  headers: { key: string; line: string }[]; attachments: { name: string; size: number; type: string }[];
  labels: string[];
};
export type Identity = { kind: "email"; value: string; create: boolean } | { kind: "phone"; value: string; create: false };
export type Decision = { status: "pending" | "ignored" | "review"; reason: string; identity?: Identity };
export function ourAddress(email: string) {
  const domain = email.toLowerCase().split("@")[1];
  return DOMAINS.some(root => domain === root || domain?.endsWith(`.${root}`));
}
export function phone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(value.trim()) ? `+${digits}` : null;
}
export function email(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(candidate) && candidate.length <= 254 ? candidate : null;
}
export async function parseMail(source: Buffer, receivedAt: Date, labels: string[]): Promise<Mail> {
  if (source.length > MAX_SOURCE_BYTES) throw new Error("message-too-large");
  const parsed = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true });
  const addresses = (value: typeof parsed.to): Address[] => (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap(group => group.value).map(a => ({ email: a.address?.toLowerCase() || "", name: a.name || "" }));
  return {
    messageId: parsed.messageId || "", subject: parsed.subject || "", receivedAt: receivedAt.toISOString(),
    sentAt: parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc), bcc: addresses(parsed.bcc),
    text: parsed.text ?? "", html: typeof parsed.html === "string" ? parsed.html : "",
    headers: [...(parsed.headerLines || [])], labels,
    attachments: parsed.attachments.map(a => ({ name: a.filename || "unnamed", size: a.size, type: a.contentType })),
  };
}
function header(mail: Mail, key: string): string {
  return mail.headers.find(h => h.key.toLowerCase() === key)?.line.replace(/^[^:]+:\s*/, "") || "";
}
const websiteSubject = /^(?:New consultation request\b|New lead\b|Project review requested\b)/i;
function recipients(mail: Mail) { return [...mail.to, ...mail.cc, ...(mail.bcc || [])]; }
function receivedByUs(mail: Mail) {
  return recipients(mail).some(a => ourAddress(a.email)) || ourAddress(header(mail, "delivered-to").trim());
}
function websiteNotification(mail: Mail) {
  return mail.from.length === 1 && ourAddress(mail.from[0].email) && receivedByUs(mail) && websiteSubject.test(mail.subject);
}
function loggingAddress(address: string) {
  // Dedicated forwarding/logging addresses are never customers. A logging
  // Bcc on a genuine customer message is retained without choosing that Bcc.
  return /^[^@]+@(?:forward|bcc)(?:\.[a-z0-9-]+)?\.hubspot\.com$/i.test(address);
}
function sentEnvelope(mail: Mail) {
  return mail.labels.includes("\\Sent") && mail.from.length === 1 && VERIFIED_HELLO_ALIASES.includes(mail.from[0].email)
    && recipients(mail).some(a => !ourAddress(a.email) && !loggingAddress(a.email)) && !websiteNotification(mail);
}
/** The actual portal's supported outgoing enum is EMAIL, not OUTGOING_EMAIL. */
export function emailDirection(mail: Mail): "EMAIL" | "INCOMING_EMAIL" {
  return sentEnvelope(mail) ? "EMAIL" : "INCOMING_EMAIL";
}
export function emailTimestamp(mail: Mail) {
  if (emailDirection(mail) === "INCOMING_EMAIL") return mail.receivedAt;
  if (!mail.sentAt || !Number.isFinite(Date.parse(mail.sentAt))) throw new Error("missing-original-sent-date");
  return mail.sentAt;
}
function sentTemplate(mail: Mail) {
  // Observed producers include Gmail SMTP templates with no Auto-Submitted
  // header. Match their concrete new-message subjects, not human Re:/Fwd:.
  return /^\[Partial\]\s|^\[Outreach reply\]\s|^Callback requested:|^Project request\b|^P5 Daily Snapshot\b|^P5 URGENT:/i.test(mail.subject)
    || /: (?:internal estimate record|estimate delivery needs attention) \(ref /i.test(mail.subject)
    || /^P5: .*(?:has no owner|needs attention|follow-up overdue)/i.test(mail.subject)
    || websiteSubject.test(mail.subject);
}
/** Trust only Gmail's first Authentication-Results, never a later injected copy. */
function authenticated(mail: Mail, domain: string): boolean {
  const results = header(mail, "authentication-results").replace(/\r?\n[ \t]+/g, " ");
  if (!/^mx\.google\.com\s*;/i.test(results)) return false;
  const dmarc = results.split(";").find(part => /\bdmarc=pass\b/i.test(part));
  const from = dmarc?.match(/\bheader\.from=([^\s;]+)/i)?.[1].toLowerCase();
  return from === domain.toLowerCase();
}
export function classify(mail: Mail): Decision {
  if (!/^<[^<>\s]+@[^<>\s]+>$/.test(mail.messageId)) return { status: "review", reason: "missing-or-invalid-rfc-message-id" };
  if (!mail.text && !mail.html) return { status: "review", reason: "no-readable-body" };
  if (mail.text.length > 1_000_000 || mail.html.length > 1_000_000) return { status: "review", reason: "body-too-large-for-crm" };
  if (mail.labels.some(label => ["\\Junk", "\\Spam", "\\Trash"].includes(label))) return { status: "review", reason: "spam-or-trash-retained" };
  if (mail.labels.includes("\\Draft")) return { status: "ignored", reason: "draft" };
  if (mail.from.length !== 1 || !email(mail.from[0].email)) return { status: "review", reason: "ambiguous-sender" };
  const sender = mail.from[0].email, domain = sender.split("@")[1];
  if (mail.labels.includes("\\Sent") && !websiteNotification(mail)) {
    if (!VERIFIED_HELLO_ALIASES.includes(sender)) return { status: "review", reason: "unverified-sent-alias" };
    if (header(mail, "list-unsubscribe") || header(mail, "list-unsubscribe-post") || header(mail, "list-id")
      || /^(?:bulk|list|junk)$/i.test(header(mail, "precedence").trim())
      || (header(mail, "auto-submitted") && header(mail, "auto-submitted").trim().toLowerCase() !== "no")) return { status: "ignored", reason: "bulk-or-automated-sent" };
    if (sentTemplate(mail)) return { status: "ignored", reason: "known-automated-sent-template" };
    const all = recipients(mail);
    const external = [...new Set(all.map(a => email(a.email)).filter((a): a is string => Boolean(a && !ourAddress(a) && !loggingAddress(a))))];
    if (!all.length || all.some(a => !email(a.email))) return { status: "review", reason: "malformed-sent-recipients" };
    if (!external.length) return { status: "ignored", reason: "internal-or-logging-sent" };
    if (!mail.sentAt || !Number.isFinite(Date.parse(mail.sentAt))) return { status: "review", reason: "missing-original-sent-date" };
    return { status: "pending", reason: external.length === 1 ? "sent-correspondence" : "ambiguous-sent-recipients",
      ...(external.length === 1 ? { identity: { kind: "email", value: external[0], create: false } as Identity } : {}) };
  }
  if (!receivedByUs(mail)) return { status: "ignored", reason: "not-addressed-to-p5" };
  if (sender === "voice-noreply@google.com" || /@txt\.voice\.google\.com$/.test(sender)) {
    if (!authenticated(mail, domain)) return { status: "review", reason: "unverified-voice-transport" };
    const relay = sender.match(/^\d+\.(\d+)\.[^@]+@txt\.voice\.google\.com$/)?.[1];
    const subjectPhone = mail.subject.match(/(?:voicemail|message) from\s+([+()\d .-]+)/i)?.[1];
    const a = relay ? phone(`+${relay}`) : null, b = subjectPhone ? phone(subjectPhone) : null;
    if (a && b && a !== b) return { status: "pending", reason: "conflicting-voice-numbers" };
    const number = a || b;
    const callbacks = [...mail.text.matchAll(/call(?:\s+me)?(?:\s+back)?\s+(?:at|on)\s+([+()\d .-]{10,25})/gi)].map(m => phone(m[1])).filter(Boolean);
    if (number && callbacks.some(callback => callback !== number)) return { status: "pending", reason: "conflicting-voice-callback" };
    return { status: "pending", reason: "voice-notification", ...(number ? { identity: { kind: "phone", value: number, create: false } as Identity } : {}) };
  }
  if (ourAddress(sender)) {
    if (!authenticated(mail, domain)) return { status: "review", reason: "unverified-website-transport" };
    if (!websiteSubject.test(mail.subject)) return { status: "ignored", reason: "internal-or-outgoing" };
    // Website form values can contain newlines. Inspect ALL explicit field
    // lines, including invalid/empty ones: a forged early block must never
    // hide the real contact field later in the notification. Ambiguity holds
    // association; transport authentication does not authenticate a person.
    const names = [...mail.text.matchAll(/^Name:[ \t]*([^\r\n]*)$/gim)];
    const emails = [...mail.text.matchAll(/^Email:[ \t]*([^\r\n]*)$/gim)];
    const phones = [...mail.text.matchAll(/^Phone:[ \t]*([^\r\n]*)$/gim)];
    if (names.length !== 1 || emails.length > 1 || phones.length > 1) return { status: "pending", reason: "ambiguous-website-contact-fields" };
    const address = emails.length === 1 ? email(emails[0][1]) : null;
    if (address && !ourAddress(address) && !/@(?:txt\.voice\.)?google\.com$/.test(address)) {
      return { status: "pending", reason: "explicit-website-contact", identity: { kind: "email", value: address, create: true } };
    }
    const number = phones.length === 1 ? phone(phones[0][1]) : null;
    return { status: "pending", reason: "website-contact-needs-review", ...(number && number !== "+12084771169" ? { identity: { kind: "phone", value: number, create: false } as Identity } : {}) };
  }
  if (header(mail, "list-unsubscribe") || /^(?:bulk|list|junk)$/i.test(header(mail, "precedence").trim())) return { status: "ignored", reason: "bulk-mail" };
  if (/^(?:no-?reply|mailer-daemon|postmaster|notifications?)@/i.test(sender) || (header(mail, "auto-submitted") && header(mail, "auto-submitted").trim() !== "no")) return { status: "ignored", reason: "automated-mail" };
  return { status: "pending", reason: "external-correspondence", identity: { kind: "email", value: sender, create: false } };
}
