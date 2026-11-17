/**
 * Email for guided estimates. Pure, so the wording and the disclosure wall
 * are testable.
 *
 * Two messages and they must never be confused:
 *
 *  teamReport           internal, to the team inbox. ONE email per estimate
 *                       (owner request, 16 November 2026): the lead alert and
 *                       the internal report in a single message. It carries
 *                       the tap-to-call, text and email buttons, the HubSpot
 *                       deal and contact, QuickBooks, the scope platform, and
 *                       every cost, price and margin. The estimator's lead
 *                       goes through the intake with its own "New lead"
 *                       alert switched off (deliver.ts), so the team is not
 *                       mailed twice.
 *  customerConfirmation to the customer, only when the official QuickBooks
 *                       estimate is not being sent right away. It is built
 *                       from the customer view alone and carries no figure
 *                       at all: the official number reaches a customer from
 *                       QuickBooks, never from a second document that could
 *                       disagree with it.
 *
 * The team report's subject must not start with "New lead": the inbox sync
 * mirrors "New lead" mail into HubSpot (inbox-policy.ts), and internal costs
 * and margins stay out of HubSpot.
 */

import { phoneHref } from "../../../lib/p5/phoneHref.ts";
import { estimatorConfirmation } from "../leads/scheduleEmail.ts";
import type { Message } from "../notifications/render.ts";
import { brandConfig } from "./brands.ts";
import type { GuidedRow } from "./store.ts";
import type { BrandId } from "./types.ts";

/** Where the full internal report goes. */
export const TEAM_INBOX = "hello@p5homeco.com";

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "unknown" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "unknown" : `${(Number(n) * 100).toFixed(1)}%`);

const oneLine = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** What the lead intake stored for this estimate: where to open it and where it came from. */
export type TeamReportLead = {
  dealId: number | null;
  /** The lead in the P5 admin. */
  adminUrl: string | null;
  hubspotDealUrl: string | null;
  hubspotContactUrl: string | null;
  /** Source, campaign, click ids and landing page, as the lead alert lists them. */
  attribution: readonly { label: string; value: string }[];
  /** Why there is no lead, when the intake step failed. */
  problem?: string | null;
};

export type TeamReportLinks = {
  scopeUrl: string | null;
  qboUrl: string | null;
  estimateNumber: string | null;
  /** Plain words: "Sent to customer", "Created, not sent", "Waiting for review"... */
  status: string;
  customerViewUrl: string;
  /** Absent only when the report is built without a delivery behind it. */
  lead?: TeamReportLead | null;
};

export function teamReport(row: GuidedRow, links: TeamReportLinks): Message {
  const brand = brandConfig(row.brand as BrandId);
  const brandName = brand?.name ?? row.brand;
  const r = row.internal_report;
  const view = row.customer_view;
  const name = `${row.first_name} ${row.last_name}`.trim();
  const review = row.review ?? [];
  const needsReview = review.length > 0;
  const lead = links.lead ?? null;
  const subject = `${needsReview ? "Review" : "New"} online estimate: ${name}, ${view.projectName}, ${money(Number(row.total))} (${brandName})`;

  const phone = oneLine(row.phone);
  const email = oneLine(row.email);
  const tel = phone ? phoneHref(phone, "tel") : "";
  const sms = phone ? phoneHref(phone, "sms") : "";
  const address = oneLine(row.address);
  const maps = address ? mapsUrl(address) : "";
  const attribution = lead?.attribution ?? [];
  const rangeLine = r.range
    ? `${money(r.range.low)} to ${money(r.range.high)} (${(r.range.width * 100).toFixed(1)}% each way; risks: ${r.range.risks.join(", ") || "none"})`
    : "";

  const property = row.property as Record<string, unknown> | null;
  const propertyLines = property
    ? [
        property.livingSqft ? `Living area: ${Number(property.livingSqft).toLocaleString("en-US")} sq ft` : null,
        property.yearBuilt ? `Year built: ${property.yearBuilt}` : null,
        property.stories ? `Stories: ${property.stories}` : null,
        property.lotAcres ? `Lot: ${property.lotAcres} acres` : null,
        property.parcel ? `Parcel: ${property.parcel}` : null,
        property.jurisdiction ? `Jurisdiction: ${property.jurisdiction}` : null,
        property.permittingAuthority ? `Permits: ${property.permittingAuthority}` : null,
        property.zoning ? `Zoning: ${property.zoning}` : null,
        `Source: ${property.source ?? "public record"}${property.confirmed ? ", confirmed by the customer" : ", not confirmed by the customer"}`,
      ].filter(Boolean)
    : ["No property record was used."];

  const text: string[] = [
    subject,
    "",
    "CUSTOMER",
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Property: ${address || "not given"}`,
    `Website: ${brandName}`,
    `Marketing consent: ${row.marketing_consent ? "yes" : "no"}`,
    tel ? `Call: ${tel}` : "",
    sms ? `Text: ${sms}` : "",
    maps ? `Map: ${maps}` : "",
    "",
    "OPEN",
    lead?.hubspotDealUrl ? `HubSpot deal: ${lead.hubspotDealUrl}` : lead?.problem ? `HubSpot deal: no lead was created (${lead.problem})` : "HubSpot deal: still syncing; open the P5 admin lead",
    lead?.hubspotContactUrl ? `HubSpot contact: ${lead.hubspotContactUrl}` : "",
    links.qboUrl ? `QuickBooks: ${links.qboUrl}` : "QuickBooks: not created",
    links.scopeUrl ? `Scope platform: ${links.scopeUrl}` : "",
    `Customer's view: ${links.customerViewUrl}`,
    lead?.adminUrl ? `P5 admin lead: ${lead.adminUrl}` : "",
    "",
    "PROJECT",
    `Type: ${view.projectName}`,
    `Selections: ${view.summary.join("; ")}`,
    `Estimate type: ${view.classLabel}`,
    `Estimate number: ${links.estimateNumber ?? "not created yet"}`,
    `Status: ${links.status}`,
    lead?.dealId ? `Deal id: ${lead.dealId}` : "",
    "",
    "PROPERTY INFORMATION USED",
    ...propertyLines.map(String),
    "",
  ];
  if (needsReview) {
    text.push("NEEDS REVIEW", ...review.map((x) => `- ${x.message}`), row.price_withheld ? "The customer was NOT shown a price." : "The customer was shown the price below.", "");
  }
  text.push(
    "FINANCIAL SUMMARY",
    r.range ? `Range shown to the customer: ${rangeLine}` : "",
    `Base price the range is built on: ${money(r.totalPrice)}`,
    `Internal cost: ${money(r.totalCost)}`,
    `Gross profit: ${money(r.grossProfit)}`,
    `Gross margin: ${pct(r.grossMargin)}`,
    "",
    "PRICING ADJUSTMENTS",
    ...r.adjustments.map((x) => `- ${x}`),
    `Cost book version ${row.cost_book_version}, estimator rules ${row.rules_version}`,
    "",
    "BY PHASE AND DIVISION (cost / price)",
    ...r.phases.map((p) => `${p.phase}: ${money(p.cost)} / ${money(p.price)}`),
    ...r.groups.map((g) => `  ${g.division}: ${money(g.cost)} / ${money(g.price)}`),
    "",
    "LINE ITEMS (code | description | qty | unit cost | cost | unit price | price)",
    ...r.lines.map((l) => `${l.code ?? "-"} | ${l.description} | ${l.quantity} ${l.unit} | ${money(l.unitCost)} | ${money(l.cost)} | ${money(l.unitPrice)} | ${money(l.price)}${l.allowance ? " | allowance" : ""}`),
    "",
    "ASSUMPTIONS",
    ...view.assumptions.map((x) => `- ${x}`),
    "",
    "NOT INCLUDED",
    ...view.exclusions.map((x) => `- ${x}`),
    "",
  );
  if (attribution.length) text.push("SOURCE AND ATTRIBUTION", ...attribution.map((f) => `  ${oneLine(f.label)}: ${oneLine(f.value)}`), "");
  text.push("Confidential. Internal costs and margins are in this message only. Do not forward it to a customer.");

  // HTML: one column, built to be acted on from a phone. Tables carry three
  // columns at most so nothing is cut off on a narrow screen.
  const INK = "#20231f";
  const MUTED = "#4a4f49";
  const LINE = "rgba(32,35,31,.15)";
  const button = (href: string, label: string, primary = false) =>
    `<a href="${esc(href)}" style="display:block;margin:0 0 10px;padding:${primary ? 16 : 14}px 18px;text-align:center;font-size:${primary ? 20 : 16}px;font-weight:700;text-decoration:none;${primary ? "background:#383837;color:#fbfaf6;border-bottom:4px solid #b08a5a" : `background:#fbfaf6;color:${INK};border:1px solid rgba(32,35,31,.3)`}">${esc(label)}</a>`;
  const section = (title: string, body: string) =>
    `<h2 style="margin:26px 0 10px;padding-top:16px;border-top:1px solid ${LINE};font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">${esc(title)}</h2>${body}`;
  const fact = (label: string, value: string, href?: string) =>
    `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:${MUTED};font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;font-size:14px;color:${INK}">${href ? `<a href="${esc(href)}" style="color:${INK}">${esc(value)}</a>` : esc(value)}</td></tr>`;
  const facts = (rows: string[]) => `<table role="presentation" style="width:100%;border-collapse:collapse">${rows.join("")}</table>`;
  const bullets = (items: readonly string[]) => `<ul style="font-size:14px;line-height:1.55;margin:0;padding-left:20px;color:${INK}">${items.map((x) => `<li style="margin:0 0 4px">${esc(x)}</li>`).join("")}</ul>`;
  const stat = (label: string, value: string) =>
    `<td style="padding:10px 6px;text-align:center;vertical-align:top;border:1px solid ${LINE};width:33%"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div><div style="font-size:16px;font-weight:700;color:${INK};margin-top:4px">${esc(value)}</div></td>`;
  const th = (label: string, right = false) => `<th style="text-align:${right ? "right" : "left"};padding:6px 0 6px ${right ? 10 : 0}px;border-bottom:2px solid #383837;font-size:12px;color:${MUTED};font-weight:700">${esc(label)}</th>`;
  const cell = (body: string, right = false, strong = false) =>
    `<td style="padding:8px 0 8px ${right ? 10 : 0}px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};vertical-align:top;${right ? "text-align:right;white-space:nowrap;" : ""}${strong ? "font-weight:700;" : ""}">${body}</td>`;

  const open = [
    lead?.hubspotDealUrl
      ? button(lead.hubspotDealUrl, "Open the HubSpot deal", true)
      : `<p style="margin:0 0 10px;font-size:14px;color:${INK}">${lead?.problem ? `HubSpot deal: no lead was created (${esc(lead.problem)}).` : "HubSpot deal: still syncing. Open the P5 admin lead, which links to it once the sync finishes."}</p>`,
    lead?.hubspotContactUrl ? button(lead.hubspotContactUrl, "HubSpot contact") : "",
    links.qboUrl ? button(links.qboUrl, "QuickBooks estimate") : "",
    links.scopeUrl ? button(links.scopeUrl, "Scope platform") : "",
    button(links.customerViewUrl, "What the customer sees"),
    lead?.adminUrl ? button(lead.adminUrl, "P5 admin lead") : "",
  ].join("");

  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f1ede4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${INK}">
<div style="max-width:600px;margin:0 auto;background:#fbfaf6;padding:20px;border:1px solid ${LINE}">
<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">${needsReview ? "Review" : "New"} online estimate: ${esc(brandName)}</p>
<h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:${INK}">${esc(name)}</h1>
<p style="margin:0 0 14px;font-size:15px;color:${INK}">${esc(view.projectName)} &middot; ${esc(view.classLabel)}</p>
<p style="margin:0;font-size:30px;font-weight:700;color:${INK}">${esc(money(Number(row.total)))}</p>
<p style="margin:2px 0 12px;font-size:13px;color:${MUTED}">Base price. ${r.range ? `The customer was shown <strong style="color:${INK}">${esc(money(r.range.low))} to ${esc(money(r.range.high))}</strong>.` : "The customer was not shown a range."}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr>${stat("Internal cost", money(r.totalCost))}${stat("Gross profit", money(r.grossProfit))}${stat("Gross margin", pct(r.grossMargin))}</tr></table>
${needsReview ? `<div style="background:#fbf1e3;border-left:4px solid #c48d3f;padding:12px 14px;margin:0 0 16px;font-size:14px;color:${INK}"><strong>Needs review.</strong> ${row.price_withheld ? "The customer was not shown a price." : "The customer was shown this price."}<ul style="margin:6px 0 0;padding-left:18px">${review.map((x) => `<li>${esc(x.message)}</li>`).join("")}</ul></div>` : ""}
${tel ? button(tel, `Call ${phone}`, true) : ""}
${sms ? button(sms, `Text ${phone}`) : ""}
${email ? button(`mailto:${email}`, `Email ${email}`) : ""}
${address ? `<p style="margin:6px 0 0;font-size:15px"><a href="${esc(maps)}" style="color:${INK}">${esc(address)}</a> (open in maps)</p>` : `<p style="margin:6px 0 0;font-size:14px;color:${MUTED}">No property address given.</p>`}
${section("Open", open)}
${section("Estimate", facts([
    fact("Estimate number", links.estimateNumber ?? "not created yet"),
    fact("Status", links.status),
    fact("Type", view.classLabel),
    fact("Website", brandName),
    ...(r.range ? [fact("Range shown", rangeLine)] : []),
    fact("Marketing consent", row.marketing_consent ? "yes" : "no"),
    ...(lead?.dealId ? [fact("Deal id", String(lead.dealId))] : []),
  ]))}
${section("What the customer chose", bullets(view.summary))}
${section("Property information used", bullets(propertyLines.map(String)))}
${section("Cost and price by phase and division", `<table style="width:100%;border-collapse:collapse"><tr>${th("Phase / division")}${th("Cost", true)}${th("Price", true)}</tr>
${r.phases.map((p) => `<tr>${cell(esc(p.phase), false, true)}${cell(esc(money(p.cost)), true, true)}${cell(esc(money(p.price)), true, true)}</tr>${r.groups.filter((g) => g.phase === p.phase).map((g) => `<tr>${cell(`<span style="padding-left:12px;display:block">${esc(g.division)}</span>`)}${cell(esc(money(g.cost)), true)}${cell(esc(money(g.price)), true)}</tr>`).join("")}`).join("")}
<tr>${cell("Total", false, true)}${cell(esc(money(r.totalCost)), true, true)}${cell(esc(money(r.totalPrice)), true, true)}</tr></table>`)}
${section("Line items", `<table style="width:100%;border-collapse:collapse"><tr>${th("Work")}${th("Cost", true)}${th("Price", true)}</tr>
${r.lines.map((l) => `<tr>${cell(`${esc(l.description)}${l.allowance ? " <em>(allowance)</em>" : ""}<div style="font-size:12px;color:${MUTED};margin-top:3px">${l.code ? `${esc(l.code)} &middot; ` : ""}${esc(l.quantity)} ${esc(l.unit)} at ${esc(money(l.unitCost))} cost, ${esc(money(l.unitPrice))} price</div>`)}${cell(esc(money(l.cost)), true)}${cell(esc(money(l.price)), true)}</tr>`).join("")}</table>`)}
${section("Pricing adjustments", bullets([...r.adjustments, `Cost book version ${row.cost_book_version}, estimator rules ${row.rules_version}`]))}
${section("Assumptions", bullets(view.assumptions))}
${section("Not included", bullets(view.exclusions))}
${attribution.length ? section("Source and attribution", facts(attribution.map((f) => fact(oneLine(f.label), oneLine(f.value), /^https:\/\/\S+$/.test(oneLine(f.value)) ? oneLine(f.value) : undefined)))) : ""}
<p style="font-size:12px;color:${MUTED};margin:26px 0 0;padding-top:14px;border-top:1px solid ${LINE}">Confidential. Internal costs and margins are in this message only. Do not forward it to a customer.</p>
</div></body></html>`;
  return { subject, text: text.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n"), html };
}

/**
 * A short note to the customer when the official estimate is not going out
 * from QuickBooks right away. No figures: it links back to the estimate they
 * already saw.
 */
export function customerConfirmation(row: GuidedRow, viewUrl: string): Message {
  const brand = brandConfig(row.brand as BrandId);
  const view = row.customer_view;
  return estimatorConfirmation({
    firstName: row.first_name,
    brandName: brand?.name ?? "P5 Home Co",
    project: view.projectName,
    viewUrl,
    phone: brand?.phoneDisplay,
    accent: brand?.accent,
  });
}
