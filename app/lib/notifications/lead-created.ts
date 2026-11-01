/**
 * One-shot team notice when a public form creates a lead.
 *
 * Intake and the short request both call this after a created deal. The path
 * is independent of P5_LEAD_ALERT_EMAILS_ENABLED. That flag only gates the
 * SLA escalation dispatcher. A send failure is logged and must not change
 * the HTTP status.
 */

import { PUBLIC_EMAIL } from "../../publicIdentity.ts";
import { SYNTHETIC_ESTIMATOR_FORM } from "../leads/synthetic-qa.ts";
import { activeTransport, type Transport } from "./transport.ts";

export type LeadCreatedNotifyInput = {
  dealId: number;
  brand: string;
  projectType: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  propertyCity: string | null;
  propertyAddress: string | null;
  summary: string | null;
  source: string | null;
  originalForm: string | null;
  /** Request kind, contact preference, best time and file links, when sent. */
  extraLines?: readonly string[];
};

export type LeadCreatedNotifyOptions = {
  transport?: Transport;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function adminDealUrl(dealId: number): string {
  const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
  return `${base}/admin/lead/${dealId}`;
}

export async function notifyLeadCreated(
  input: LeadCreatedNotifyInput,
  options: LeadCreatedNotifyOptions = {},
): Promise<void> {
  if (input.originalForm === SYNTHETIC_ESTIMATOR_FORM) return;
  try {
    const name =
      oneLine([input.firstName, input.lastName].filter(Boolean).join(" ")) || "Unnamed contact";
    const brand = oneLine(input.brand) || "P5 Home Co";
    const subject = `New quote enquiry: ${name} · ${brand}`;
    const lines = [
      `Brand: ${input.brand}`,
      `Project: ${input.projectType ?? "(not specified)"}`,
      `Name: ${name}`,
      `Email: ${input.email ?? ""}`,
      `Phone: ${input.phone ?? ""}`,
      `City: ${input.propertyCity ?? ""}`,
      `Address: ${input.propertyAddress ?? ""}`,
      `Source: ${input.source ?? ""}`,
      `Deal id: ${input.dealId}`,
      ...(input.extraLines ?? []),
      "",
      input.summary ?? "",
      "",
      "Open the admin deals view to follow up.",
      adminDealUrl(input.dealId),
    ];
    const text = lines.join("\n");
    const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
    const transport = options.transport ?? activeTransport();
    const result = await transport.send(PUBLIC_EMAIL, { subject, text, html });
    if (!result.ok) {
      console.error(`[intake-notify] send to ${PUBLIC_EMAIL} failed: ${result.error}`);
    }
  } catch (error) {
    console.error("[intake-notify]", (error as Error).message);
  }
}

export type LeadFollowUpNotifyInput = {
  dealId: number;
  brand: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  /** One line per detail or file, already formatted. */
  lines: readonly string[];
  reroutedFrom?: string | null;
};

/**
 * Short follow-up when a visitor adds details or files to a request already
 * emailed: "Details added: {name}". Same mailbox, same fail-open rule.
 */
export async function notifyLeadDetailsAdded(
  input: LeadFollowUpNotifyInput,
  options: LeadCreatedNotifyOptions & { subjectPrefix?: string } = {},
): Promise<void> {
  try {
    const name =
      oneLine([input.firstName, input.lastName].filter(Boolean).join(" ")) || "Unnamed contact";
    const subject = `${options.subjectPrefix ?? "Details added"}: ${name} · ${oneLine(input.brand) || "P5 Home Co"}`;
    const lines = [
      `Name: ${name}`,
      `Phone: ${input.phone ?? ""}`,
      `Email: ${input.email ?? ""}`,
      input.reroutedFrom ? `Routed from ${input.reroutedFrom} to ${input.brand} by the project type.` : "",
      `Deal id: ${input.dealId}`,
      "",
      ...input.lines,
      "",
      adminDealUrl(input.dealId),
    ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
    const text = lines.join("\n");
    const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
    const transport = options.transport ?? activeTransport();
    const result = await transport.send(PUBLIC_EMAIL, { subject, text, html });
    if (!result.ok) {
      console.error(`[intake-notify] follow-up to ${PUBLIC_EMAIL} failed: ${result.error}`);
    }
  } catch (error) {
    console.error("[intake-notify]", (error as Error).message);
  }
}
