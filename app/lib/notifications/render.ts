/**
 * Turn alerts into a message somebody will actually act on.
 *
 * Pure, so the wording is testable. The goal is that the subject line alone
 * tells the reader whether to stop what they are doing, and the body gives
 * each lead's name, why it is flagged, and a direct link -- so acting on it
 * is one tap rather than a hunt through a dashboard.
 */

import type { Bundle, Notifiable } from "./routing.ts";

export type Message = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * "2 hours", "35 minutes" — how long the *customer* has been waiting.
 *
 * Measured from when the lead arrived, not when the alert fired. Those differ
 * by hours in exactly the cases that matter most.
 */
export function waitingFor(item: Notifiable, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - item.receivedAt.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The subject line.
 *
 * Leads with the worst thing rather than a generic label, because a subject
 * reading "P5: 3 leads need attention" is indistinguishable from noise, while
 * "P5 URGENT: Maria Alvarez has waited 9 hours" is not.
 */
export function subjectFor(bundle: Bundle, now: Date): string {
  const worst = bundle.items[0];
  const others = bundle.items.length - 1;
  const suffix = others > 0 ? ` (+${others} more)` : "";

  if (worst.kind === "response_ceiling_breached") {
    return `P5 URGENT: ${worst.clientName} has waited ${waitingFor(worst, now)} with no reply${suffix}`;
  }
  if (worst.tier === "critical" || worst.tier === "administrator") {
    return `P5 URGENT: ${worst.clientName} needs a response now${suffix}`;
  }
  if (worst.kind === "missing_owner") {
    return `P5: ${worst.clientName} has no owner${suffix}`;
  }
  if (worst.kind === "next_action_overdue") {
    return `P5: follow-up overdue for ${worst.clientName}${suffix}`;
  }
  return `P5: ${worst.clientName} needs attention${suffix}`;
}

export function renderBundle(bundle: Bundle, baseUrl: string, now: Date): Message {
  const subject = subjectFor(bundle, now);
  const greeting = bundle.recipient.name.split(" ")[0];

  const lines = bundle.items.map((i) => {
    const link = `${baseUrl}/admin/lead/${i.dealId}`;
    return {
      title: `${i.clientName} — ${i.brand}`,
      reason: i.reason,
      waiting: waitingFor(i, now),
      link,
    };
  });

  const text = [
    `${greeting},`,
    "",
    bundle.items.length === 1
      ? "One lead needs you:"
      : `${bundle.items.length} leads need you:`,
    "",
    ...lines.flatMap((l) => [
      `• ${l.title}`,
      `  ${l.reason}`,
      `  Waiting ${l.waiting}`,
      `  ${l.link}`,
      "",
    ]),
    "Open the board: " + `${baseUrl}/admin/lead-manager`,
    "",
    "You are getting this because the lead is assigned to you or you cover escalations.",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1ede4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#20231f">
<div style="max-width:560px;margin:0 auto;background:#fbfaf6;padding:24px;border:1px solid rgba(32,35,31,.15)">
<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6c756e">P5 Home Co</p>
<h1 style="margin:0 0 18px;font-size:20px;font-weight:600">${escapeHtml(
    bundle.items.length === 1 ? "One lead needs you" : `${bundle.items.length} leads need you`,
  )}</h1>
${lines
  .map(
    (l) => `<div style="margin:0 0 16px;padding:14px;border-left:3px solid #9a2f2f;background:#f1ede4">
<div style="font-weight:650;font-size:15px">${escapeHtml(l.title)}</div>
<div style="margin:6px 0;font-size:14px">${escapeHtml(l.reason)}</div>
<div style="font-size:12px;color:#343934">Waiting ${escapeHtml(l.waiting)}</div>
<a href="${escapeHtml(l.link)}" style="display:inline-block;margin-top:10px;padding:9px 16px;background:#233029;color:#fff;text-decoration:none;font-size:13px;font-weight:650">Open this lead</a>
</div>`,
  )
  .join("")}
<p style="margin:20px 0 0;font-size:12px;color:#6c756e">You are getting this because the lead is assigned to you, or you cover escalations.</p>
</div></body></html>`;

  return { subject, text, html };
}
