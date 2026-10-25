/**
 * One-shot team notice when public intake creates a lead.
 *
 * This path is independent of P5_LEAD_ALERT_EMAILS_ENABLED. That flag only
 * gates the SLA escalation dispatcher. A send failure is logged and must not
 * change the intake HTTP status.
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
