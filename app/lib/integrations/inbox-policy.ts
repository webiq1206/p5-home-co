import { simpleParser } from "mailparser";

export const MAILBOX = "hello@p5homeco.com";
export const PORTAL = 247066159;
export const OWNER = "97300513";
export const DOMAINS = ["p5homeco.com", "boisecabinet.co", "boiseconstruction.co", "boiseremodeling.co", "boisehandyman.co", "boiseadu.co"];
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export type Address = { email: string; name: string };
export type Mail = {
  messageId: string; subject: string; receivedAt: string; sentAt: string | null;
  from: Address[]; to: Address[]; cc: Address[]; text: string; html: string;
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
    from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc),
    text: parsed.text ?? "", html: typeof parsed.html === "string" ? parsed.html : "",
    headers: [...(parsed.headerLines || [])], labels,
    attachments: parsed.attachments.map(a => ({ name: a.filename || "unnamed", size: a.size, type: a.contentType })),
  };
}
function header(mail: Mail, key: string): string {
  return mail.headers.find(h => h.key.toLowerCase() === key)?.line.replace(/^[^:]+:\s*/, "") || "";
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
  const receivedByUs = [...mail.to, ...mail.cc].some(a => ourAddress(a.email)) || ourAddress(header(mail, "delivered-to").trim());
  if (!receivedByUs) return { status: "ignored", reason: "not-addressed-to-p5" };
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
    if (!/^(?:New consultation request\b|New lead\b|Project review requested\b)/i.test(mail.subject)) return { status: "ignored", reason: "internal-or-outgoing" };
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
