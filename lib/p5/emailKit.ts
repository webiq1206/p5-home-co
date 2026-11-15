import { phoneHref } from "./phoneHref.ts";

/**
 * Shared branded email kit for every P5 estimator message.
 *
 * Pure functions. No environment reads and no brand imports. Callers pass an
 * EmailBrand. The same blocks render the HTML and the plain-text fallback.
 *
 * Nick can edit VALUE_TIERS. Those bounds change next-step wording only.
 * They never change a price.
 */

export const CHARCOAL = "#383837";
export const PAPER = "#fbfaf6";
export const WHITE = "#ffffff";
export const PAGE = "#f4f4f2";
export const MUTED = "#5c615c";
export const LINE = "#e1e5dd";
export const REVIEW = "#c48d3f";
export const REVIEW_BG = "#fbf1e3";

export const SCHEDULE_URL = "https://meetings-na2.hubspot.com/client3";

/**
 * Internal operations mailbox. Test-mode mail and the alert sent when a
 * customer email fails always go here. Normal brand admin recipients do not.
 */
export const INTERNAL_OPS_EMAIL = "hello@p5homeco.com";

/** Test mode and the failed-customer alert ignore the brand inbox. */
export function internalDeliveryTo(purpose: "test" | "alert", _brand?: { email?: string; name?: string }): string {
  void purpose;
  void _brand;
  return INTERNAL_OPS_EMAIL;
}

/** t1886u. Kept verbatim on every customer estimate email. */
export const ESTIMATE_DISCLAIMER =
  "We work hard to make that estimate as realistic as we can, but we can't give you a true bid until we walk the property. Depending on the scope and what we find, the bid may come in higher or lower than this first estimate. Either way, we'll work with you to get you what you want, within your budget.";

/**
 * Value tiers. Nick can edit these two numbers.
 * under smallUnder: small job. smallUnder through majorOver: standard.
 * over majorOver: major project. Wording and next steps only.
 */
export const VALUE_TIERS = {
  smallUnder: 10_000,
  majorOver: 75_000,
} as const;

export type ValueTier = "small" | "standard" | "major";

export type EmailBrand = {
  name: string;
  accent: string;
  /** Button and footer ground. Callers pass the site ink from brand.ts. */
  charcoal: string;
  /** Absolute https PNG. Omitted from the header when it is not https. */
  logoUrl: string;
  siteUrl: string;
  phoneDisplay: string;
  phoneTel: string;
  cityLine: string;
  replyTo: string;
};

/** The fields a brand.ts record supplies. Shared mail reads these and nothing else. */
export type BrandSource = {
  name: string;
  domain: string;
  email: string;
  phone: string;
  accent: string;
  ink: string;
  logo: string;
  cityLine?: string;
};

/**
 * City and ZIP for an email footer. A line that starts with a street number
 * is left off, so a street address is never printed.
 */
export function footerCityLine(value: string | null | undefined): string {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!line || /^\d/.test(line)) return "";
  return line;
}

/** The one email dial link. 10 US digits become tel:+1…, matching phoneHref. */
export function telHref(phone: string): string {
  return phoneHref(phone, "tel");
}

/** Digits for a tel: href, without the scheme. Empty when the number is not dialable. */
export function phoneTelFrom(phone: string): string {
  const href = telHref(phone);
  return href.startsWith("tel:") ? href.slice(4) : "";
}

/** Build the email brand from the site-owned brand record. No parent name or URL is filled in here. */
export function emailBrandFrom(source: BrandSource): EmailBrand {
  const domain = String(source.domain || "").replace(/^https:\/\//, "").replace(/\/+$/, "");
  const logo = String(source.logo || "");
  const logoPath = logo.startsWith("/") ? logo : logo ? `/${logo}` : "";
  const logoUrl = /^https:\/\//i.test(logo) ? logo : domain && logoPath ? `https://${domain}${logoPath}` : "";
  return {
    name: source.name,
    accent: source.accent,
    charcoal: source.ink,
    logoUrl,
    siteUrl: domain ? `https://${domain}` : "",
    phoneDisplay: source.phone,
    phoneTel: phoneTelFrom(source.phone),
    cityLine: source.cityLine ?? "",
    replyTo: source.email,
  };
}

/** A name containing "test", or ESTIMATOR_TEST_MODE on the env the caller passes. */
export function estimatorTestMode(
  name: string | null | undefined,
  env: Record<string, string | undefined> = {},
): boolean {
  if (String(name ?? "").toLowerCase().includes("test")) return true;
  const flag = String(env.ESTIMATOR_TEST_MODE ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on" || flag === "yes";
}

export function valueTier(high: number | null | undefined): ValueTier {
  if (high == null || !Number.isFinite(high)) return "standard";
  if (high < VALUE_TIERS.smallUnder) return "small";
  if (high > VALUE_TIERS.majorOver) return "major";
  return "standard";
}

/**
 * Next-step wording for the three value tiers. Wording only: the numbers
 * never change. Each sentence is distinct.
 */
export function tierNextStep(high: number | null | undefined): string {
  const schedule = "On the scheduling page, choose the 1 hour option.";
  const tier = valueTier(high);
  if (tier === "small") return `The next step is a quick visit, or we can confirm the work by phone. ${schedule}`;
  if (tier === "major") return `The next step is a planning consultation. We will go through plans and permits with you. ${schedule}`;
  return `The next step is a home walkthrough, so we can see the property and turn this estimate into a true bid. ${schedule}`;
}

export function formatMoney(amount: number, cents = true): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function formatBoise(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Boise",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${parts} MT`;
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const REAL_HREF = /^(https:\/\/|tel:|mailto:|sms:)[^\s"'<>]+$/i;

/** A button renders only for a real https, tel, mailto or sms URL. */
export function isRealHref(value: string | null | undefined): value is string {
  const trimmed = String(value ?? "").trim();
  if (!REAL_HREF.test(trimmed)) return false;
  if (/^https:\/\/qbo\.intuit\.com\/app\/estimate/i.test(trimmed) || /^https:\/\/app\.sandbox\.qbo\.intuit\.com\/app\/estimate/i.test(trimmed)) {
    return /[?&]txnId=[^&]+/i.test(trimmed);
  }
  return true;
}

export function button(options: {
  href: string | null | undefined;
  label: string;
  variant?: "primary" | "secondary";
  accent?: string;
}): string {
  if (!isRealHref(options.href)) return "";
  const href = esc(options.href.trim());
  const label = esc(options.label);
  const accent = /^#[0-9a-fA-F]{6}$/.test(options.accent ?? "") ? options.accent : CHARCOAL;
  if ((options.variant ?? "primary") === "secondary") {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 12px;">
<tr>
<td align="center" bgcolor="${PAPER}" style="background-color:${PAPER};border:2px solid ${CHARCOAL};">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:520px;" arcsize="4%" strokecolor="${CHARCOAL}" fillcolor="${PAPER}">
<w:anchorlock/>
<center style="color:${CHARCOAL};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${href}" target="_blank" style="display:block;padding:12px 20px;background-color:${PAPER};color:${CHARCOAL};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;border:0;mso-hide:all;">${label}</a>
<!--<![endif]-->
</td>
</tr>
</table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 12px;">
<tr>
<td align="center" bgcolor="${CHARCOAL}" style="background-color:${CHARCOAL};">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:520px;" arcsize="4%" strokecolor="${CHARCOAL}" fillcolor="${CHARCOAL}">
<w:anchorlock/>
<center style="color:${WHITE};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${href}" target="_blank" style="display:block;padding:14px 22px;background-color:${CHARCOAL};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;border:0;mso-hide:all;">${label}</a>
<!--<![endif]-->
</td>
</tr>
<tr>
<td bgcolor="${accent}" style="background-color:${accent};height:4px;font-size:0;line-height:0;">&nbsp;</td>
</tr>
</table>`;
}

export type Field = { label: string; value: string; href?: string | null };

export function filledFields(rows: readonly Field[]): Field[] {
  return rows.filter((row) => {
    const label = row.label.trim();
    const value = row.value.trim();
    return Boolean(label) && Boolean(value) && value !== "undefined" && value !== "null" && !label.includes("{{");
  });
}

export function keyValueTable(rows: readonly Field[]): string {
  const items = filledFields(rows);
  if (!items.length) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${items
    .map((row) => {
      const value = esc(row.value);
      const href = isRealHref(row.href) ? esc(row.href.trim()) : "";
      const cell = href ? `<a href="${href}" style="color:${CHARCOAL};">${value}</a>` : value.replace(/\n/g, "<br>");
      return `<tr><td style="padding:7px 12px 7px 0;border-bottom:1px solid ${LINE};font-size:13px;line-height:1.4;color:${MUTED};vertical-align:top;width:38%;">${esc(row.label)}</td><td style="padding:7px 0;border-bottom:1px solid ${LINE};font-size:15px;line-height:1.45;color:${CHARCOAL};vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">${cell}</td></tr>`;
    })
    .join("")}</table>`;
}

export function section(title: string, body: string): string {
  const inner = body.trim();
  if (!title.trim() || !inner) return "";
  return `<h2 style="margin:22px 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700;">${esc(title)}</h2>${inner}`;
}

export function bulletList(items: readonly string[]): string {
  const rows = items.map((item) => item.trim()).filter((item) => item && item !== "undefined" && !item.includes("{{"));
  if (!rows.length) return "";
  return `<ul style="margin:0 0 8px;padding:0 0 0 18px;">${rows
    .map((item) => `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${CHARCOAL};overflow-wrap:anywhere;word-break:break-word;">${esc(item)}</li>`)
    .join("")}</ul>`;
}

export function amountBlock(input: {
  mode: "range" | "single" | "withheld";
  low?: number | null;
  high?: number | null;
  label?: string;
  note?: string;
  accent: string;
}): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : CHARCOAL;
  const label = input.label?.trim() || (input.mode === "withheld" ? "Estimate status" : "Preliminary estimate");
  let figure: string;
  if (input.mode === "withheld" || input.low == null || input.high == null) {
    figure = "Your project needs a closer look before we share a number. A person on the team will follow up to confirm the details.";
  } else if (input.mode === "single" || input.low === input.high) {
    figure = formatMoney(input.low);
  } else {
    figure = `${formatMoney(input.low)} to ${formatMoney(input.high)}`;
  }
  const note = input.note?.trim() ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:${MUTED};">${esc(input.note.trim())}</p>` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 18px;"><tr><td bgcolor="${PAPER}" style="background-color:${PAPER};border-top:4px solid ${accent};padding:18px 18px 16px;"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(label)}</p><p style="margin:0;font-size:28px;line-height:1.25;font-weight:700;color:${CHARCOAL};">${esc(figure)}</p>${note}</td></tr></table>`;
}

export function notice(kind: "info" | "review" | "confidential", text: string): string {
  const body = text.trim();
  if (!body) return "";
  const tone = kind === "review" ? { bar: REVIEW, bg: REVIEW_BG } : kind === "confidential" ? { bar: "#9e3324", bg: "#fbede9" } : { bar: CHARCOAL, bg: PAPER };
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 16px;"><tr><td bgcolor="${tone.bg}" style="background-color:${tone.bg};border-left:4px solid ${tone.bar};padding:12px 14px;font-size:14px;line-height:1.5;color:${CHARCOAL};">${esc(body)}</td></tr></table>`;
}

export function scheduleBlock(brand: EmailBrand, note?: string): { html: string; text: string } {
  const line = note?.trim() || tierNextStep(null);
  const html = `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${CHARCOAL};">${esc(line)}</p>${button({
    href: SCHEDULE_URL,
    label: "Schedule now",
    variant: "primary",
    accent: brand.accent,
  })}<p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:${MUTED};">${esc(ESTIMATE_DISCLAIMER)}</p>`;
  const text = [line, "", `Schedule now: ${SCHEDULE_URL}`, "", ESTIMATE_DISCLAIMER].join("\n");
  return { html, text };
}

export type Block =
  | { type: "p"; text: string }
  | { type: "section"; title: string; rows: Field[] }
  | { type: "bullets"; title?: string; items: string[] }
  | { type: "amount"; mode: "range" | "single" | "withheld"; low?: number | null; high?: number | null; label?: string; note?: string }
  | { type: "notice"; kind: "info" | "review" | "confidential"; text: string }
  | { type: "buttons"; items: { label: string; href: string | null | undefined; variant?: "primary" | "secondary" }[] }
  | { type: "schedule"; note?: string }
  | { type: "raw"; html: string; text: string };

function blockHtml(block: Block, brand: EmailBrand): string {
  if (block.type === "p") {
    const text = block.text.trim();
    return text ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${CHARCOAL};">${esc(text)}</p>` : "";
  }
  if (block.type === "section") return section(block.title, keyValueTable(block.rows));
  if (block.type === "bullets") {
    const list = bulletList(block.items);
    return list ? `${block.title ? section(block.title, list) : list}` : "";
  }
  if (block.type === "amount") return amountBlock({ ...block, accent: brand.accent });
  if (block.type === "notice") return notice(block.kind, block.text);
  if (block.type === "buttons") {
    const html = block.items
      .map((item, index) => button({ href: item.href, label: item.label, variant: item.variant ?? (index === 0 ? "primary" : "secondary"), accent: brand.accent }))
      .join("");
    return html;
  }
  if (block.type === "schedule") return scheduleBlock(brand, block.note).html;
  return block.html;
}

function blockText(block: Block): string[] {
  if (block.type === "p") return block.text.trim() ? [block.text.trim()] : [];
  if (block.type === "section") {
    const rows = filledFields(block.rows);
    if (!rows.length) return [];
    return [block.title.toUpperCase(), ...rows.map((row) => `${row.label}: ${row.value}${isRealHref(row.href) ? ` (${row.href!.trim()})` : ""}`)];
  }
  if (block.type === "bullets") {
    const items = block.items.map((item) => item.trim()).filter(Boolean);
    if (!items.length) return [];
    return [...(block.title ? [block.title.toUpperCase()] : []), ...items.map((item) => `- ${item}`)];
  }
  if (block.type === "amount") {
    const label = block.label?.trim() || "Preliminary estimate";
    if (block.mode === "withheld" || block.low == null || block.high == null) {
      return [label.toUpperCase(), "Your project needs a closer look before we share a number. A person on the team will follow up to confirm the details.", ...(block.note?.trim() ? [block.note.trim()] : [])];
    }
    const figure = block.mode === "single" || block.low === block.high ? formatMoney(block.low) : `${formatMoney(block.low)} to ${formatMoney(block.high)}`;
    return [label.toUpperCase(), figure, ...(block.note?.trim() ? [block.note.trim()] : [])];
  }
  if (block.type === "notice") return block.text.trim() ? [block.text.trim()] : [];
  if (block.type === "buttons") {
    return block.items.filter((item) => isRealHref(item.href)).map((item) => `${item.label}: ${item.href!.trim()}`);
  }
  if (block.type === "schedule") return scheduleBlock({ name: "", accent: CHARCOAL, charcoal: CHARCOAL, logoUrl: "", siteUrl: "", phoneDisplay: "", phoneTel: "", cityLine: "", replyTo: "" }, block.note).text.split("\n");
  return block.text.trim() ? block.text.trim().split("\n") : [];
}

export function toText(blocks: readonly Block[]): string {
  return blocks.flatMap((block) => blockText(block)).join("\n");
}

function footerBits(brand: EmailBrand): string[] {
  const site = brand.siteUrl.replace(/^https:\/\//, "").replace(/\/+$/, "");
  return [brand.name, footerCityLine(brand.cityLine), brand.phoneDisplay, site].map((part) => part.trim()).filter(Boolean);
}

function footerText(brand: EmailBrand, footerNote?: string): string[] {
  const lines = [footerBits(brand).join(" · ")];
  if (footerNote?.trim()) lines.push(footerNote.trim());
  return lines.filter(Boolean);
}

export function layout(input: {
  brand: EmailBrand;
  preheader: string;
  title: string;
  kicker?: string;
  body: string;
  footerNote?: string;
}): string {
  const site = input.brand.siteUrl.replace(/\/+$/, "");
  const logo = /^https:\/\//i.test(input.brand.logoUrl)
    ? `<img src="${esc(input.brand.logoUrl)}" alt="${esc(input.brand.name)}" width="220" style="display:block;width:220px;max-width:70%;height:auto;border:0;">`
    : "";
  const ink = input.brand.charcoal || CHARCOAL;
  const phone = input.brand.phoneTel
    ? `<a href="tel:${esc(input.brand.phoneTel)}" style="color:#f4f4f2;text-decoration:underline;"><span style="white-space:nowrap">${esc(input.brand.phoneDisplay)}</span></a>`
    : `<span style="white-space:nowrap">${esc(input.brand.phoneDisplay)}</span>`;
  const siteLink = /^https:\/\//i.test(site) ? `<a href="${esc(site)}" style="color:#f4f4f2;text-decoration:underline;"><span style="white-space:nowrap">${esc(site.replace(/^https:\/\//, ""))}</span></a>` : "";
  const footer = [esc(input.brand.name), esc(footerCityLine(input.brand.cityLine)), phone, siteLink].filter((part) => part && part !== "undefined").join(" · ");
  const extra = input.footerNote?.trim() ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#d9d9d6;">${esc(input.footerNote.trim())}</p>` : "";
  const kicker = input.kicker?.trim()
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(input.kicker.trim())}</p>`
    : "";
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(input.title)}</title>
<style>
@media (max-width:620px){
  .container{width:100%!important}
  .pad{padding-left:16px!important;padding-right:16px!important}
  h1{font-size:24px!important}
}
@media (prefers-color-scheme:dark){
  .page{background:${PAGE}!important}
  .card,.pad{background:${WHITE}!important;color:${ink}!important}
}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${PAGE};color:${ink};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(input.preheader)}</div>
<table role="presentation" class="page" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAGE}" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="container card" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="${WHITE}" style="width:600px;max-width:100%;border-collapse:collapse;background:${WHITE};border:1px solid ${LINE};">
<tr><td class="pad" bgcolor="${WHITE}" style="padding:26px 28px 0;background:${WHITE};">${logo}</td></tr>
<tr><td bgcolor="${input.brand.accent}" style="background-color:${input.brand.accent};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="pad" bgcolor="${WHITE}" style="padding:22px 28px 0;background:${WHITE};">${kicker}<h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;font-weight:700;color:${ink};">${esc(input.title)}</h1></td></tr>
<tr><td class="pad" bgcolor="${WHITE}" style="padding:0 28px 28px;background:${WHITE};">${input.body}</td></tr>
<tr><td class="pad" bgcolor="${ink}" style="padding:18px 28px 22px;background:${ink};">
<p style="margin:0;font-size:13px;line-height:1.6;color:#f4f4f2;">${footer}</p>
${extra}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmail(input: {
  brand: EmailBrand;
  preheader: string;
  title: string;
  kicker?: string;
  blocks: readonly Block[];
  footerNote?: string;
}): { html: string; text: string } {
  const body = input.blocks.map((block) => blockHtml(block, input.brand)).join("");
  const text = [...toText(input.blocks).split("\n"), "", ...footerText(input.brand, input.footerNote)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const html = layout({ ...input, body });
  return { html, text };
}

const DASH = /[\u2013\u2014]/;
const OUR_PLACE = /showroom|\b(?:our|the company's|visit (?:our|the))\s+shop\b/i;
const OUR_STREET = new RegExp(`\\b${"40" + "31"}\\b|\\b${"wa" + "poot"}\\b`, "i");

/** Throws when customer-facing copy breaks a hard rule. Customer property addresses are removed first. */
export function assertCopy(html: string, text: string, options?: { requireDisclaimer?: boolean; customerAddresses?: string[] }): void {
  let visible = `${html}\n${text}`;
  for (const address of options?.customerAddresses ?? []) {
    if (address.trim()) visible = visible.split(address).join(" ");
  }
  const plain = visible.replace(/<[^>]+>/g, " ");
  if (DASH.test(plain)) throw new Error("Email copy contains an em or en dash");
  if (OUR_PLACE.test(plain)) throw new Error("Email copy names a shop or showroom");
  if (OUR_STREET.test(plain)) throw new Error("Email copy contains a street address");
  if (/\bundefined\b/.test(plain)) throw new Error("Email copy contains undefined");
  if (plain.includes("{{")) throw new Error("Email copy contains a template placeholder");
  if (options?.requireDisclaimer && !text.includes(ESTIMATE_DISCLAIMER)) throw new Error("Customer email is missing the estimate disclaimer");
}
