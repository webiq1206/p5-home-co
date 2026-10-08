import { Parser } from "htmlparser2";
import { MAILBOX, type Mail } from "./inbox-policy.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function sourcePrefix(expected: string, actual: string) {
  return actual === expected || (actual.startsWith(expected) &&
    (!expected || /\s$/.test(expected) || /^\s/.test(actual.slice(expected.length))));
}

/** Append provenance after the intact decoded source. Never convert the
 * original MIME alternative or upload attachment binaries. */
export function emailContent(mail: Mail, sourceId: string) {
  if (!/^\d+$/.test(sourceId)) throw new Error("gmail-source-id-unverified");
  const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAILBOX)}#all/${BigInt(sourceId).toString(16)}`;
  const originalDate = mail.headers.find(h => h.key.toLowerCase() === "date")?.line.replace(/^date:\s*/i, "").replace(/\r?\n[ \t]+/g, " ") || "Not supplied";
  const details = [
    `Original Date header: ${originalDate}`,
    `Parsed sent date: ${mail.sentAt || "Not available"}`,
    `Gmail received timestamp: ${mail.receivedAt}`,
    `RFC Message-ID: ${mail.messageId}`,
    ...mail.attachments.map(a => `Attachment: ${a.name || "Unnamed"} (${a.size} bytes; ${a.type || "unknown type"})`),
    ...(mail.attachments.length ? ["Original attachment files remain in Gmail; binaries are not uploaded to HubSpot."] : []),
  ];
  return {
    text: `${mail.text}\n\n--- P5 source record ---\nOriginal Gmail message (${MAILBOX}): ${url}\n${details.join("\n")}`,
    html: mail.html ? `${mail.html}\n<hr><section><p><strong>P5 source record</strong></p><p><a href="${escapeHtml(url)}">Original Gmail message (${MAILBOX})</a></p>${details.map(line => `<p>${escapeHtml(line)}</p>`).join("")}</section>` : "",
  };
}

function htmlEvidence(html: string) {
  let text = "", hidden = 0;
  const links: string[] = [];
  const invisible = new Set(["head", "script", "style", "template"]);
  const block = /^(?:p|div|br|hr|li|ul|ol|table|tr|td|th|section|article|header|footer|blockquote|pre|h[1-6])$/;
  new Parser({
    onopentag(name, attributes) {
      if (invisible.has(name)) hidden++;
      if (hidden) return;
      if (block.test(name)) text += " ";
      for (const key of ["href", "src", "srcset", "poster"]) if (attributes[key]) links.push(`${key}:${attributes[key]}`);
      if (name === "img" && attributes.alt) text += ` ${attributes.alt} `;
    },
    ontext(value) { if (!hidden) text += value; },
    onclosetag(name) {
      if (invisible.has(name)) hidden = Math.max(0, hidden - 1);
      else if (!hidden && block.test(name)) text += " ";
    },
  }, { decodeEntities: true }).end(html);
  return { text: text.replace(/\s+/g, " ").trim(), links: links.sort() };
}

/** HubSpot can sanitize markup. Prove visible content and original link/image
 * targets instead of accepting any nonempty HTML. Unverifiable content holds. */
export function htmlMatches(expected: string, actual: string, allowFooter = false) {
  if (!expected) return !actual;
  if (!actual) return false;
  const source = htmlEvidence(expected), saved = htmlEvidence(actual);
  if (!source.text && !source.links.length) return false;
  if (allowFooter ? !sourcePrefix(source.text, saved.text) : saved.text !== source.text) return false;
  const remaining = [...saved.links];
  for (const link of source.links) {
    const index = remaining.indexOf(link);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return allowFooter || remaining.length === 0;
}
