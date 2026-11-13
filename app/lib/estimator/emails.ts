/**
 * Email for guided estimates. Pure, so the wording and the disclosure wall
 * are testable.
 *
 * Two messages and they must never be confused:
 *
 *  teamReport           internal, to the team inbox. Carries every cost,
 *                       price and margin.
 *  customerConfirmation to the customer, only when the official QuickBooks
 *                       estimate is not being sent right away. It is built
 *                       from the customer view alone and carries no figure
 *                       at all: the official number reaches a customer from
 *                       QuickBooks, never from a second document that could
 *                       disagree with it.
 */

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

const digits = (phone: string) => phone.replace(/\D/g, "");

export type TeamReportLinks = {
  scopeUrl: string | null;
  qboUrl: string | null;
  estimateNumber: string | null;
  /** Plain words: "Sent to customer", "Created, not sent", "Waiting for review"... */
  status: string;
  customerViewUrl: string;
};

export function teamReport(row: GuidedRow, links: TeamReportLinks): Message {
  const brand = brandConfig(row.brand as BrandId);
  const r = row.internal_report;
  const view = row.customer_view;
  const name = `${row.first_name} ${row.last_name}`.trim();
  const review = row.review ?? [];
  const needsReview = review.length > 0;
  const subject = `${needsReview ? "Review" : "New"} online estimate: ${name}, ${view.projectName}, ${money(Number(row.total))} (${brand?.name ?? row.brand})`;

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
    `Email: ${row.email}`,
    `Phone: ${row.phone}`,
    `Property: ${row.address ?? "not given"}`,
    `Website: ${brand?.name ?? row.brand}`,
    `Marketing consent: ${row.marketing_consent ? "yes" : "no"}`,
    "",
    "PROJECT",
    `Type: ${view.projectName}`,
    `Selections: ${view.summary.join("; ")}`,
    `Estimate type: ${view.classLabel}`,
    `Estimate number: ${links.estimateNumber ?? "not created yet"}`,
    `Status: ${links.status}`,
    links.qboUrl ? `QuickBooks: ${links.qboUrl}` : "QuickBooks: not created",
    links.scopeUrl ? `Scope platform: ${links.scopeUrl}` : "",
    `Customer's view: ${links.customerViewUrl}`,
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
    r.range ? `Range shown to the customer: ${money(r.range.low)} to ${money(r.range.high)} (${(r.range.width * 100).toFixed(1)}% each way; risks: ${r.range.risks.join(", ") || "none"})` : "",
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
    "Confidential. Internal costs and margins are in this message only. Do not forward it to a customer.",
  );

  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #383837;font-size:12px"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;vertical-align:top"';
  const tdr = 'style="padding:6px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;white-space:nowrap;vertical-align:top"';
  const h2 = 'style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:26px 0 8px;color:#705a45"';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#383837;max-width:760px">
<p style="font-size:18px;margin:0 0 4px"><strong>${esc(name)}</strong> &middot; ${esc(view.projectName)}</p>
<p style="font-size:26px;margin:0 0 6px"><strong>${esc(money(Number(row.total)))}</strong> <span style="font-size:13px;color:#6b6b69">${esc(view.classLabel)} &middot; ${esc(brand?.name ?? row.brand)}</span></p>
${r.range ? `<p style="font-size:14px;margin:0 0 4px">Customer was shown <strong>${esc(money(r.range.low))} to ${esc(money(r.range.high))}</strong> (${esc((r.range.width * 100).toFixed(1))}% each way; risks: ${esc(r.range.risks.join(", ") || "none")}). The figure above is the base price.</p>` : ""}
<p style="font-size:14px;margin:0 0 4px">Internal cost ${esc(money(r.totalCost))} &middot; Gross profit <strong>${esc(money(r.grossProfit))}</strong> &middot; Gross margin <strong>${esc(pct(r.grossMargin))}</strong></p>
${needsReview ? `<div style="background:#fbf1e3;border-left:4px solid #c48d3f;padding:10px 12px;margin:14px 0"><strong>Needs review.</strong> ${row.price_withheld ? "The customer was not shown a price." : "The customer was shown this price."}<ul style="margin:6px 0 0;padding-left:18px">${review.map((x) => `<li>${esc(x.message)}</li>`).join("")}</ul></div>` : ""}
<p ${h2}>Customer</p>
<p style="font-size:14px;line-height:1.7;margin:0">
<a href="mailto:${esc(row.email)}">${esc(row.email)}</a><br>
<a href="tel:+1${esc(digits(row.phone).slice(-10))}">${esc(row.phone)}</a><br>
${esc(row.address ?? "No property address given")}<br>
From ${esc(brand?.name ?? row.brand)} &middot; Marketing consent: ${row.marketing_consent ? "yes" : "no"}</p>
<p ${h2}>Project</p>
<p style="font-size:14px;line-height:1.7;margin:0">${esc(view.summary.join(" · "))}<br>
Estimate number: ${esc(links.estimateNumber ?? "not created yet")} &middot; Status: <strong>${esc(links.status)}</strong><br>
${links.qboUrl ? `<a href="${esc(links.qboUrl)}">Open in QuickBooks</a>` : "Not in QuickBooks yet"}${links.scopeUrl ? ` &middot; <a href="${esc(links.scopeUrl)}">Open in the scope platform</a>` : ""} &middot; <a href="${esc(links.customerViewUrl)}">What the customer sees</a></p>
<p ${h2}>Property information used</p>
<p style="font-size:14px;line-height:1.7;margin:0">${propertyLines.map(esc).join("<br>")}</p>
<p ${h2}>By phase and division</p>
<table style="border-collapse:collapse;width:100%"><tr><th ${th}>Phase / division</th><th ${th} align="right">Cost</th><th ${th} align="right">Price</th></tr>
${r.phases.map((p) => `<tr><td ${td}><strong>${esc(p.phase)}</strong></td><td ${tdr}><strong>${esc(money(p.cost))}</strong></td><td ${tdr}><strong>${esc(money(p.price))}</strong></td></tr>${r.groups.filter((g) => g.phase === p.phase).map((g) => `<tr><td ${td}>&nbsp;&nbsp;${esc(g.division)}</td><td ${tdr}>${esc(money(g.cost))}</td><td ${tdr}>${esc(money(g.price))}</td></tr>`).join("")}`).join("")}
<tr><td ${td}><strong>Total</strong></td><td ${tdr}><strong>${esc(money(r.totalCost))}</strong></td><td ${tdr}><strong>${esc(money(r.totalPrice))}</strong></td></tr></table>
<p ${h2}>Line items</p>
<table style="border-collapse:collapse;width:100%"><tr><th ${th}>Code</th><th ${th}>Work</th><th ${th} align="right">Qty</th><th ${th} align="right">Unit cost</th><th ${th} align="right">Cost</th><th ${th} align="right">Price</th></tr>
${r.lines.map((l) => `<tr><td ${td}>${esc(l.code ?? "")}</td><td ${td}>${esc(l.description)}${l.allowance ? " <em>(allowance)</em>" : ""}</td><td ${tdr}>${esc(l.quantity)} ${esc(l.unit)}</td><td ${tdr}>${esc(money(l.unitCost))}</td><td ${tdr}>${esc(money(l.cost))}</td><td ${tdr}>${esc(money(l.price))}</td></tr>`).join("")}</table>
<p ${h2}>Pricing adjustments</p>
<ul style="font-size:13px;line-height:1.6;margin:0;padding-left:18px">${r.adjustments.map((x) => `<li>${esc(x)}</li>`).join("")}<li>Cost book version ${esc(row.cost_book_version)}, estimator rules ${esc(row.rules_version)}</li></ul>
<p ${h2}>Assumptions</p>
<ul style="font-size:13px;line-height:1.6;margin:0;padding-left:18px">${view.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p ${h2}>Not included</p>
<ul style="font-size:13px;line-height:1.6;margin:0;padding-left:18px">${view.exclusions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p style="font-size:12px;color:#6b6b69;margin-top:26px">Confidential. Internal costs and margins are in this message only. Do not forward it to a customer.</p>
</div>`;
  return { subject, text: text.filter((line) => line !== undefined).join("\n"), html };
}

/**
 * A short note to the customer when the official estimate is not going out
 * from QuickBooks right away. No figures: it links back to the estimate they
 * already saw.
 */
export function customerConfirmation(row: GuidedRow, viewUrl: string): Message {
  const brand = brandConfig(row.brand as BrandId);
  const view = row.customer_view;
  const brandName = brand?.name ?? "P5 Home Co";
  const project = view.projectName.toLowerCase();
  const subject = `Your ${project} estimate from ${brandName}`;
  const next = row.price_withheld
    ? "Our team is looking over your project so the number we send is one we can stand behind. You will hear from us shortly."
    : view.estimateClass === "budgetary"
      ? "A project lead will reach out to talk through your goals, your site and your timeline. That conversation is how a budget becomes a real plan."
      : "We are confirming the details, and your official estimate will follow by email. You will be able to review and approve it there.";
  const text = [
    `Hi ${row.first_name},`,
    "",
    `Thanks for thinking of ${brandName} for your ${project}. Your estimate is saved, and you can pull it up any time:`,
    viewUrl,
    "",
    next,
    "",
    `If you have questions, just reply to this email or call ${brand?.phoneDisplay ?? "(208) 477-1169"}.`,
    "",
    `The ${brandName} team`,
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#383837;max-width:560px;font-size:15px;line-height:1.6">
<p>Hi ${esc(row.first_name)},</p>
<p>Thanks for thinking of ${esc(brandName)} for your ${esc(project)}. Your estimate is saved, and you can pull it up any time.</p>
<p><a href="${esc(viewUrl)}" style="display:inline-block;background:#383837;color:#fbfaf6;text-decoration:none;padding:12px 20px;border-bottom:3px solid ${esc(brand?.accent ?? "#ceb391")}">View your estimate</a></p>
<p>${esc(next)}</p>
<p>If you have questions, just reply to this email or call ${esc(brand?.phoneDisplay ?? "(208) 477-1169")}.</p>
<p>The ${esc(brandName)} team</p>
</div>`;
  return { subject, text, html };
}
