/**
 * Email for guided estimates. Pure, so the wording is testable.
 *
 * The customer message shows the range stored on customer_view. It does not
 * recompute a price. Internal cost, margin and cost codes stay in the team
 * report only.
 */

import { ESTIMATOR_BRAND } from "../../../lib/p5/brand.ts";
import { phoneHref } from "../../../lib/p5/phoneHref.ts";
import {
  ESTIMATE_DISCLAIMER,
  SCHEDULE_URL,
  estimatorTestMode,
  formatBoise,
  formatMoney,
  renderEmail,
  tierNextStep,
  valueTier,
  type Block,
  type EmailBrand,
  type Field,
  type ValueTier,
} from "../../../lib/p5/emailKit.ts";
import { estimatorConfirmation } from "../leads/scheduleEmail.ts";
import type { Message } from "../notifications/render.ts";
import { BRAND_CONFIGS, brandConfig } from "./brands.ts";
import { flowById } from "./flows.ts";
import type { GuidedRow } from "./store.ts";
import { TIER_LABELS, type BrandId, type Tier } from "./types.ts";

/** Where the full internal report goes. The From name stays P5 Home Co at send time. */
export const TEAM_INBOX = "hello@p5homeco.com";

const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "unknown" : formatMoney(Number(n));

const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "unknown" : `${(Number(n) * 100).toFixed(1)}%`);

export function emailBrandFor(id: string | null | undefined): EmailBrand {
  const live = brandConfig(id) ?? BRAND_CONFIGS.p5;
  return {
    name: live.name,
    accent: live.id === ESTIMATOR_BRAND.id || live.id === "adu" ? ESTIMATOR_BRAND.accent : live.accent,
    charcoal: "#383837",
    logoUrl: live.logoUrl,
    siteUrl: live.site,
    phoneDisplay: "(208) 477-1169",
    phoneTel: "+12084771169",
    cityLine: "Meridian, ID 83646",
    replyTo: live.site ? `hello@${live.site.replace(/^https:\/\//, "")}` : "hello@p5homeco.com",
  };
}

export type UploadLink = { name: string; url?: string | null };

export type TeamReportLinks = {
  scopeUrl: string | null;
  qboUrl: string | null;
  estimateNumber: string | null;
  /** Plain words: "Sent to customer", "Created, not sent", "Waiting for review"... */
  status: string;
  customerViewUrl: string;
  leadUrl?: string | null;
  hubspotContactUrl?: string | null;
  hubspotDealUrl?: string | null;
  uploads?: readonly UploadLink[];
  testLead?: boolean;
};

type EmailRow = GuidedRow & { uploads?: readonly UploadLink[] };

function uploadsOf(row: GuidedRow, links?: readonly UploadLink[]): UploadLink[] {
  const extra = (row as EmailRow).uploads;
  const list = links ?? extra ?? [];
  return list.filter((file) => file.name.trim());
}

function familyOf(project: string): "cabinets" | "remodel" | "construction" | "light" {
  const group = flowById(project)?.group ?? "";
  if (group === "cabinetry") return "cabinets";
  if (group === "construction" || group === "adu" || project === "addition") return "construction";
  if (group === "handyman" || project === "interior-paint" || project === "flooring") return "light";
  return "remodel";
}

export function nextStepCopy(_project: string, high: number | null | undefined): string {
  return tierNextStep(high);
}

function thanksCopy(brand: string, project: string, tier: ValueTier): string {
  const name = project.trim().toLowerCase() || "project";
  if (tier === "small") return `Thanks for using the Instant Estimator at ${brand}. Here is the preliminary range for this smaller ${name}.`;
  if (tier === "major") return `Thanks for using the Instant Estimator at ${brand}. Here is the preliminary range for your ${name}. A project of this size starts with a planning conversation.`;
  return `Thanks for thinking of ${brand} for your ${name}. Your preliminary estimate is below, and you can pull it up any time.`;
}

function cap(items: readonly string[] | undefined, max: number): string[] {
  return (items ?? []).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function answerRows(row: GuidedRow): Field[] {
  const answers = row.answers ?? {};
  const flow = flowById(row.project);
  if (!flow) {
    return Object.entries(answers).map(([label, value]) => ({ label, value: formatAnswer(value) }));
  }
  const rows: Field[] = [];
  for (const question of flow.questions) {
    const value = answers[question.id];
    if (value == null || value === "") continue;
    if (question.kind === "choice") {
      const label = question.options.find((option) => option.id === value)?.label ?? String(value);
      rows.push({ label: question.prompt, value: label });
    } else if (question.kind === "number") {
      rows.push({ label: question.prompt, value: `${value} ${question.unit}` });
    } else if (question.kind === "tasks" && typeof value === "object") {
      for (const [id, count] of Object.entries(value as Record<string, number>)) {
        if (!count) continue;
        const label = question.options.find((option) => option.id === id)?.label ?? id;
        rows.push({ label, value: String(count) });
      }
    }
  }
  return rows;
}

function formatAnswer(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, count]) => `${key}: ${count}`).join(", ");
  return String(value);
}

function propertyRows(row: GuidedRow): Field[] {
  const property = row.property as Record<string, unknown> | null;
  if (!property) return [{ label: "Record", value: "No property record was used." }];
  const rows: Field[] = [];
  if (property.livingSqft) rows.push({ label: "Living area", value: `${Number(property.livingSqft).toLocaleString("en-US")} sq ft` });
  if (property.yearBuilt) rows.push({ label: "Year built", value: String(property.yearBuilt) });
  if (property.stories) rows.push({ label: "Stories", value: String(property.stories) });
  if (property.lotAcres) rows.push({ label: "Lot", value: `${property.lotAcres} acres` });
  if (property.parcel) rows.push({ label: "Parcel", value: String(property.parcel) });
  if (property.jurisdiction) rows.push({ label: "Jurisdiction", value: String(property.jurisdiction) });
  if (property.permittingAuthority) rows.push({ label: "Permits", value: String(property.permittingAuthority) });
  if (property.zoning) rows.push({ label: "Zoning", value: String(property.zoning) });
  rows.push({
    label: "Source",
    value: `${property.source ?? "public record"}${property.confirmed ? ", confirmed by the customer" : ", not confirmed by the customer"}`,
  });
  return rows;
}

function qboHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /[?&]txnId=[^&]+/i.test(url) ? url : null;
}

function statusPill(row: GuidedRow, status: string): string {
  if (/fail/i.test(status)) return "QBO failed";
  if (row.price_withheld) return "Price withheld";
  if ((row.review ?? []).length > 0) return "Needs review";
  return "Ready";
}

function rangePhrase(row: GuidedRow): string {
  const range = row.customer_view?.range;
  if (row.price_withheld || !range) return "price under review";
  return `${formatMoney(range.low)} to ${formatMoney(range.high)}`;
}

function submittedAt(row: GuidedRow): string {
  const raw = row.created_at;
  const date = raw instanceof Date ? raw : new Date(raw as unknown as string);
  return formatBoise(date);
}

export function teamReport(row: GuidedRow, links: TeamReportLinks): Message {
  const brand = emailBrandFor(row.brand);
  const view = row.customer_view;
  const report = row.internal_report;
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unnamed contact";
  const testLead = links.testLead || estimatorTestMode(name);
  const project = view?.projectName || row.project || "Project";
  const subjectCore = `New estimate: ${name} · ${project} · ${rangePhrase(row)} · ${brand.name}`;
  const subject = `${testLead ? "TEST LEAD: " : ""}${subjectCore}`.slice(0, 250);
  const phone = row.phone ? phoneHref(row.phone, "tel") : "";
  const sms = row.phone ? phoneHref(row.phone, "sms") : "";
  const mailto = row.email ? `mailto:${row.email}?subject=${encodeURIComponent(subjectCore)}` : "";
  const uploads = uploadsOf(row, links.uploads);
  const fileUrl = uploads.find((file) => file.url && /^https:\/\//i.test(file.url))?.url ?? "";
  const when = submittedAt(row);
  const reference = links.estimateNumber || view?.estimateNumber || `GE-${row.id}`;
  const tierLabel = TIER_LABELS[row.tier as Tier]?.label;
  const blocks: Block[] = [
    {
      type: "notice",
      kind: (row.review ?? []).length || row.price_withheld ? "review" : "confidential",
      text: `${statusPill(row, links.status)}. ${links.status}${row.price_withheld ? " The customer was not shown a price." : ""}`,
    },
  ];
  const customerRows: Field[] = [
    { label: "Name", value: name },
    { label: "Phone", value: row.phone || "", href: phone || undefined },
    { label: "Email", value: row.email || "", href: mailto || undefined },
    { label: "Marketing consent", value: row.marketing_consent ? "yes" : "no" },
    { label: "Reference", value: reference },
    { label: "Submitted", value: when },
    { label: "Website", value: brand.name },
  ];
  blocks.push({ type: "section", title: "Customer", rows: customerRows });
  if (row.address) blocks.push({ type: "section", title: "Project location", rows: [{ label: "Address", value: row.address }] });
  blocks.push({
    type: "section",
    title: "Project",
    rows: [
      { label: "Brand", value: brand.name },
      { label: "Service", value: project },
      ...(tierLabel ? [{ label: "Tier", value: tierLabel }] : []),
      { label: "Estimate type", value: view?.classLabel || row.estimate_class || "" },
      { label: "Status", value: links.status },
    ],
  });
  const answers = answerRows(row);
  if (answers.length) blocks.push({ type: "section", title: "Selections", rows: answers });
  const property = propertyRows(row);
  if (property.length) blocks.push({ type: "section", title: "Property facts", rows: property });
  if (view?.range && !row.price_withheld) {
    blocks.push({
      type: "amount",
      mode: "range",
      low: view.range.low,
      high: view.range.high,
      label: "Estimate shown to customer",
      note: view.classLabel || "",
    });
  } else {
    blocks.push({ type: "amount", mode: "withheld", label: "Estimate shown to customer", note: "The customer was not shown a price." });
  }
  const summary = cap(view?.summary, 6);
  if (summary.length) blocks.push({ type: "bullets", title: "Summary", items: summary });
  blocks.push({
    type: "section",
    title: "Internal numbers",
    rows: [
      { label: "Total cost", value: money(report?.totalCost) },
      { label: "Total price", value: money(report?.totalPrice) },
      { label: "Gross profit", value: money(report?.grossProfit) },
      { label: "Gross margin", value: pct(report?.grossMargin) },
      ...(report?.range
        ? [{ label: "Range basis", value: `${money(report.range.low)} to ${money(report.range.high)} (${(report.range.width * 100).toFixed(1)}% each way; risks: ${report.range.risks.join(", ") || "none"})` }]
        : []),
    ],
  });
  if (report?.adjustments?.length) blocks.push({ type: "bullets", title: "Pricing adjustments", items: report.adjustments });
  const divisionLines = [
    ...(report?.phases ?? []).map((phase) => `${phase.phase}: ${money(phase.cost)} / ${money(phase.price)}`),
    ...(report?.groups ?? []).map((group) => `${group.division}: ${money(group.cost)} / ${money(group.price)}`),
  ];
  if (divisionLines.length) blocks.push({ type: "bullets", title: "By phase and division", items: divisionLines });
  const lineItems = (report?.lines ?? []).map(
    (line) => `${line.code ?? "-"} | ${line.description} | ${line.quantity} ${line.unit} | ${money(line.unitCost)} | ${money(line.cost)} | ${money(line.price)}${line.allowance ? " | allowance" : ""}`,
  );
  if (lineItems.length) blocks.push({ type: "bullets", title: "Line items", items: lineItems });
  const review = (row.review ?? []).map((item) => item.message).filter(Boolean);
  blocks.push({
    type: "section",
    title: "Review flags",
    rows: [
      { label: "Price withheld", value: row.price_withheld ? "yes" : "no" },
      { label: "Rules", value: row.rules_version || "" },
      { label: "Cost book", value: row.cost_book_version || "" },
    ],
  });
  if (review.length) blocks.push({ type: "bullets", title: "Needs review", items: review });
  if (view?.assumptions?.length) blocks.push({ type: "bullets", title: "Assumptions", items: view.assumptions });
  if (view?.exclusions?.length) blocks.push({ type: "bullets", title: "Not included", items: view.exclusions });
  const attribution = Object.entries(row.attribution ?? {}).filter(([, value]) => String(value ?? "").trim());
  if (attribution.length) blocks.push({ type: "section", title: "Attribution", rows: attribution.map(([label, value]) => ({ label, value: String(value) })) });
  const delivery = row.delivery ?? {};
  const deliveryRows: Field[] = (["scope", "lead", "qboEstimate", "qboSend", "teamEmail", "customerEmail"] as const)
    .filter((key) => delivery[key])
    .map((key) => {
      const step = delivery[key]!;
      return { label: key, value: `${step.ok ? "ok" : "failed"}${step.detail ? `: ${step.detail}` : ""}` };
    });
  if (deliveryRows.length) blocks.push({ type: "section", title: "Delivery status", rows: deliveryRows });
  if (uploads.length) {
    blocks.push({
      type: "bullets",
      title: "Uploaded files",
      items: uploads.map((file) => (file.url ? `${file.name} ${file.url}` : file.name)),
    });
  }
  blocks.push({
    type: "buttons",
    items: [
      { label: "View full estimate", href: links.scopeUrl, variant: "primary" },
      { label: "View customer page", href: links.customerViewUrl, variant: "secondary" },
      { label: "View lead details", href: links.leadUrl, variant: "secondary" },
      { label: "HubSpot contact", href: links.hubspotContactUrl, variant: "secondary" },
      { label: "HubSpot deal", href: links.hubspotDealUrl, variant: "secondary" },
      { label: "Open in QuickBooks", href: qboHref(links.qboUrl), variant: "secondary" },
      { label: phone ? `Call ${row.phone}` : "Call", href: phone, variant: "secondary" },
      { label: "Text", href: sms, variant: "secondary" },
      { label: "Email", href: mailto, variant: "secondary" },
      { label: "Schedule", href: SCHEDULE_URL, variant: "secondary" },
      { label: "View uploaded files", href: fileUrl, variant: "secondary" },
    ],
  });
  blocks.push({
    type: "notice",
    kind: "confidential",
    text: "Confidential. Internal costs and margins are in this message only. Do not forward it to a customer.",
  });
  const rendered = renderEmail({
    brand,
    preheader: `${statusPill(row, links.status)}. ${name}, ${project}, ${rangePhrase(row)}.`,
    title: name,
    kicker: [statusPill(row, links.status), reference, when].filter(Boolean).join(" · "),
    blocks,
    footerNote: "Internal estimate record.",
  });
  return { subject, text: rendered.text, html: rendered.html };
}

function plansFamily(project: string): boolean {
  return familyOf(project) === "construction";
}

function needsMore(row: GuidedRow): boolean {
  const guide = row.customer_view?.guide;
  return Boolean(
    row.price_withheld ||
      row.estimate_class === "budgetary" ||
      (row.review ?? []).length > 0 ||
      (guide?.undetermined ?? []).length > 0,
  );
}

/**
 * Customer confirmation. A stored range is shown from customer_view.
 * A row without a range and without a withheld price keeps the short note.
 */
export function customerConfirmation(row: GuidedRow, viewUrl: string): Message {
  const view = row.customer_view;
  const brand = emailBrandFor(row.brand as BrandId);
  if (!view?.range && !row.price_withheld) {
    return estimatorConfirmation({
      firstName: row.first_name,
      brandName: brand.name,
      project: view?.projectName || "project",
      viewUrl,
      phone: brand.phoneDisplay,
      accent: brand.accent,
    });
  }
  const project = (view?.projectName || "project").trim();
  const high = view?.range?.high ?? null;
  const tier: ValueTier = valueTier(high);
  const first = (row.first_name ?? "").trim() || "there";
  const subject = `Your ${project.toLowerCase()} estimate from ${brand.name}`;
  const uploads = uploadsOf(row);
  const more = needsMore(row) || (plansFamily(row.project) && uploads.length === 0);
  const included = cap(view?.guide?.included?.flatMap((group) => group.items) ?? view?.summary, 6);
  const assumptions = cap(view?.guide?.assumptions ?? view?.assumptions, 5);
  const excluded = cap(view?.guide?.excluded ?? view?.exclusions, 5);
  const stillNeed = cap([...(view?.guide?.undetermined ?? []), ...(view?.guide?.verification ?? [])], 5);
  const uploadUrl = uploads.find((file) => file.url && /^https:\/\//i.test(file.url))?.url;
  const blocks: Block[] = [
    { type: "p", text: `Hi ${first},` },
    { type: "p", text: thanksCopy(brand.name, project, tier) },
  ];
  if (view?.range && !row.price_withheld) {
    blocks.push({
      type: "amount",
      mode: view.range.low === view.range.high ? "single" : "range",
      low: view.range.low,
      high: view.range.high,
      label: view.classLabel || "Preliminary estimate",
      note: "Preliminary estimate",
    });
  } else {
    blocks.push({ type: "amount", mode: "withheld", label: "Preliminary estimate" });
  }
  if (uploads.length) blocks.push({ type: "p", text: `We received ${uploads.length} file${uploads.length === 1 ? "" : "s"}.` });
  if (included.length) blocks.push({ type: "bullets", title: "What's included", items: included });
  if (assumptions.length) blocks.push({ type: "bullets", title: "Assumptions", items: assumptions });
  if (excluded.length) blocks.push({ type: "bullets", title: "Not included", items: excluded });
  if (more && stillNeed.length) blocks.push({ type: "bullets", title: "What we still need", items: stillNeed });
  blocks.push({ type: "p", text: ESTIMATE_DISCLAIMER });
  blocks.push({ type: "p", text: nextStepCopy(row.project, high) });
  const actionItems: { label: string; href: string; variant: "primary" | "secondary" }[] = [
    { label: "View my estimate", href: viewUrl, variant: "primary" },
    { label: "Schedule now", href: SCHEDULE_URL, variant: "secondary" },
    { label: "Call us", href: `tel:${brand.phoneTel}`, variant: "secondary" },
    { label: "Reply with questions", href: `mailto:${brand.replyTo}?subject=${encodeURIComponent(subject)}`, variant: "secondary" },
  ];
  if (more && uploadUrl) actionItems.splice(1, 0, { label: "Submit your plans", href: uploadUrl, variant: "secondary" });
  blocks.push({ type: "buttons", items: actionItems });
  if (more && !uploadUrl) blocks.push({ type: "p", text: "Reply to this email with your plans." });
  blocks.push({ type: "p", text: `If you have questions, just reply to this email or call ${brand.phoneDisplay}.` });
  blocks.push({ type: "p", text: `The ${brand.name} team` });
  const range = view?.range && !row.price_withheld ? `${formatMoney(view.range.low)} to ${formatMoney(view.range.high)}` : "a closer look";
  const rendered = renderEmail({
    brand,
    preheader: `Your preliminary ${project.toLowerCase()} estimate: ${range}.`,
    title: `Your ${project.toLowerCase()} estimate`,
    kicker: brand.name,
    blocks,
  });
  return { subject, text: rendered.text, html: rendered.html };
}

/** One internal alert after the customer email fails. It does not resend to the customer. */
export function customerFailureAlert(row: GuidedRow, reason: string, reference: string): Message {
  const brand = emailBrandFor(row.brand);
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unnamed contact";
  const phone = row.phone ? phoneHref(row.phone, "tel") : "";
  const mailto = row.email ? `mailto:${row.email}` : "";
  const subject = `Customer estimate email failed: ${name} · ${reference}`;
  const rendered = renderEmail({
    brand,
    preheader: `The customer estimate email failed for ${reference}.`,
    title: "Customer email was not sent",
    kicker: reference,
    blocks: [
      { type: "notice", kind: "review", text: "This alert does not resend the estimate to the customer." },
      {
        type: "section",
        title: "Failure",
        rows: [
          { label: "Reference", value: reference },
          { label: "Reason", value: reason.trim() || "The message was not accepted." },
          { label: "Name", value: name },
          { label: "Phone", value: row.phone || "", href: phone || undefined },
          { label: "Email", value: row.email || "", href: mailto || undefined },
          { label: "Brand", value: brand.name },
          { label: "Project", value: row.customer_view?.projectName || row.project || "" },
        ],
      },
      {
        type: "buttons",
        items: [
          { label: phone ? `Call ${row.phone}` : "Call", href: phone, variant: "primary" },
          { label: "Email", href: mailto, variant: "secondary" },
        ],
      },
    ],
    footerNote: "Internal delivery alert.",
  });
  return { subject, text: rendered.text, html: rendered.html };
}
