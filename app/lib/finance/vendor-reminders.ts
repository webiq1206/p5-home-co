/**
 * Automatic subcontractor document reminders (S89).
 *
 * The attention scanner already tells P5 internally when a required vendor
 * document is missing or expiring. This closes the loop the owner asked for:
 * it emails the SUBCONTRACTOR directly, on the same 30/14/7/0 ladder, so a lapsed
 * certificate of insurance gets chased without anyone remembering to.
 *
 * Two rules keep it from becoming spam:
 *   1. Bands, not days. A document expiring in 20 days is in the "30" band; it
 *      moves to "14", "7", then "0" as time passes. Each band emails once.
 *   2. Cycles. The send ledger is keyed by the document's current expiry, so
 *      renewing a certificate starts a fresh cycle and the ladder may fire
 *      again, but the same certificate is never chased twice for the same band.
 *
 * The pure functions (stage, cycle token, message) carry the logic and the
 * wording so both are unit-tested without a database or a mail server.
 */

import { query } from "../db.ts";
import { daysUntil } from "./compliance.ts";
import type { FinanceSettings } from "./settings.ts";
import { activeTransport } from "../notifications/transport.ts";
import type { Message } from "../notifications/render.ts";

/** A reminder band the document currently sits in, or null if none applies. */
export type ReminderStage = {
  /** 'missing' | 'expired' | 't<days>' (e.g. 't30', 't14', 't7', 't0'). */
  stage: string;
  /** Days until expiry: null when missing, negative when already expired. */
  days: number | null;
};

/**
 * Which reminder band a required document sits in today, if any.
 *
 * Ordered by urgency: an expired or missing document always reminds; otherwise
 * the document is placed in the tightest ladder rung it has reached, so a
 * 20-day-out certificate reminds at the "30" rung, not every day.
 */
export function reminderStageFor(
  status: string,
  expiresOn: Date | null,
  today: Date,
  ladder: number[],
): ReminderStage | null {
  if (status === "waived") return null;

  const days = expiresOn ? daysUntil(today, expiresOn) : null;

  if (status === "expired" || (days !== null && days < 0)) {
    return { stage: "expired", days };
  }
  if (status === "missing" || status === "requested") {
    return { stage: "missing", days: null };
  }
  if (days === null) return null;

  const bands = ladder.filter((t) => t >= days);
  if (bands.length === 0) return null; // further out than the widest rung
  return { stage: `t${Math.min(...bands)}`, days };
}

/**
 * Token that identifies the document's current cycle.
 *
 * The expiry date is the natural cycle key: a new certificate has a new expiry,
 * which legitimately reopens the ladder. A missing document stays one cycle
 * until it is provided.
 */
export function cycleTokenFor(status: string, expiresOn: Date | null): string {
  if (status === "missing" || status === "requested") return "missing";
  return expiresOn ? isoDate(expiresOn) : "none";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "March 4, 2026" from an ISO date, using UTC parts so it never drifts a day. */
export function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type VendorReminderInput = {
  vendorName: string;
  contactName: string;
  docType: string;
  stage: string;
  /** Null when missing; negative when expired. */
  days: number | null;
  /** ISO expiry date, or null when the document is simply missing. */
  expiresOn: string | null;
  /** Address the sub replies to with the updated document. */
  replyTo: string;
};

/**
 * The subcontractor-facing reminder, pure so its wording is tested.
 *
 * Deliberately carries no sensitive data: the document type and dates only,
 * never a TIN or policy number. Written to be actioned in one reply.
 */
export function renderVendorDocumentReminder(input: VendorReminderInput): Message {
  const { vendorName, contactName, docType, stage, days, expiresOn, replyTo } = input;
  const first = contactName.trim().split(/\s+/)[0] || "there";
  const expiryText = expiresOn ? friendlyDate(expiresOn) : null;

  let subject: string;
  let headline: string;
  let ask: string;
  if (stage === "expired") {
    subject = `P5 Home Co: your ${docType} on file has expired`;
    headline = `Your ${docType} has expired`;
    ask = expiryText
      ? `Your ${docType} expired on ${expiryText}. Until we have a current one on file, payments to you are on hold.`
      : `Your ${docType} has expired. Until we have a current one on file, payments to you are on hold.`;
  } else if (stage === "missing") {
    subject = `P5 Home Co: we need your ${docType} on file`;
    headline = `We need your ${docType}`;
    ask = `We do not currently have your ${docType} on file. We need it before we can process payments to you.`;
  } else {
    const n = days ?? 0;
    const dayWord = `${n} day${n === 1 ? "" : "s"}`;
    subject = `P5 Home Co: your ${docType} expires in ${dayWord}`;
    headline = `Your ${docType} expires soon`;
    ask = expiryText
      ? `Your ${docType} expires on ${expiryText}, which is ${dayWord} from now. Please send an updated copy before it lapses so payments are not interrupted.`
      : `Your ${docType} expires in ${dayWord}. Please send an updated copy before it lapses so payments are not interrupted.`;
  }

  const howTo = `Please reply to this email (${replyTo}) with the updated document attached.`;
  const footer = `You are receiving this because ${vendorName} is an active vendor with P5 Home Co. This is an automated reminder.`;

  const text = [
    `Hi ${first},`,
    "",
    `This is a reminder from P5 Home Co about the compliance documents we keep on file for ${vendorName}.`,
    "",
    ask,
    "",
    howTo,
    "",
    "Thank you,",
    "P5 Home Co Accounting",
    "",
    footer,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1ede4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#20231f">
<div style="max-width:560px;margin:0 auto;background:#fbfaf6;padding:24px;border:1px solid rgba(32,35,31,.15)">
<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6c756e">P5 Home Co</p>
<h1 style="margin:0 0 18px;font-size:20px;font-weight:600">${escapeHtml(headline)}</h1>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 12px;font-size:14px">This is a reminder about the compliance documents we keep on file for ${escapeHtml(vendorName)}.</p>
<div style="margin:0 0 16px;padding:14px;border-left:3px solid #9a2f2f;background:#f1ede4;font-size:14px">${escapeHtml(ask)}</div>
<p style="margin:0 0 16px;font-size:14px">${escapeHtml(howTo)}</p>
<p style="margin:0 0 4px;font-size:14px">Thank you,</p>
<p style="margin:0 0 18px;font-size:14px">P5 Home Co Accounting</p>
<p style="margin:0;font-size:12px;color:#6c756e">${escapeHtml(footer)}</p>
</div></body></html>`;

  return { subject, text, html };
}

/** Where a sub sends the updated document. Always resolves to something real. */
function resolveReplyTo(settings: FinanceSettings): string {
  return (
    settings.vendorDocumentReminders.replyToEmail ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    "accounting@p5homeco.com"
  );
}

export type VendorReminderSummary = {
  considered: number;
  sent: number;
  skippedNoContact: number;
  alreadySent: number;
  failures: string[];
};

/**
 * Email every subcontractor with a required document that has entered a new
 * reminder band since the last run. Idempotent: the ledger insert is the lock,
 * so a band is emailed once per cycle even if the job runs many times a day.
 */
export async function sendDueVendorDocumentReminders(
  settings: FinanceSettings,
  today: Date = new Date(),
): Promise<VendorReminderSummary> {
  const summary: VendorReminderSummary = {
    considered: 0,
    sent: 0,
    skippedNoContact: 0,
    alreadySent: 0,
    failures: [],
  };
  if (!settings.vendorDocumentReminders.enabled) return summary;

  const rows = await query<{
    vendor_id: string;
    display_name: string;
    doc_type: string;
    status: string;
    expires_on: string | null;
    contact_email: string | null;
    contact_name: string | null;
  }>(
    `SELECT d.vendor_id, v.display_name, d.doc_type, d.status, d.expires_on::text,
            c.email AS contact_email, c.full_name AS contact_name
     FROM vendor_document d
     JOIN vendor_profile v ON v.id = d.vendor_id
     LEFT JOIN LATERAL (
       SELECT email, full_name FROM portal_contact
       WHERE kind = 'vendor' AND vendor_id = d.vendor_id AND is_active
       ORDER BY id ASC LIMIT 1
     ) c ON true
     WHERE d.required AND v.active AND d.status <> 'waived'`,
  );

  const transport = activeTransport();
  const replyTo = resolveReplyTo(settings);

  for (const r of rows) {
    const expires = r.expires_on ? new Date(r.expires_on) : null;
    const stage = reminderStageFor(r.status, expires, today, settings.complianceReminderDays);
    if (!stage) continue;
    summary.considered += 1;

    if (!r.contact_email) {
      // Nobody to email. The internal attention item already covers this, so it
      // is not lost, just not chaseable by email until a portal contact exists.
      summary.skippedNoContact += 1;
      continue;
    }

    const cycleToken = cycleTokenFor(r.status, expires);

    // The ledger insert is the send-once lock. If nothing comes back, this
    // (vendor, doc, band, cycle) was already emailed.
    const reserved = await query<{ id: string }>(
      `INSERT INTO vendor_document_reminder (vendor_id, doc_type, stage, cycle_token, sent_to)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (vendor_id, doc_type, stage, cycle_token) DO NOTHING
       RETURNING id`,
      [r.vendor_id, r.doc_type, stage.stage, cycleToken, r.contact_email],
    );
    if (reserved.length === 0) {
      summary.alreadySent += 1;
      continue;
    }

    const message = renderVendorDocumentReminder({
      vendorName: r.display_name,
      contactName: r.contact_name ?? "",
      docType: r.doc_type,
      stage: stage.stage,
      days: stage.days,
      expiresOn: r.expires_on,
      replyTo,
    });

    const result = await transport.send(r.contact_email, message);
    if (result.ok) {
      summary.sent += 1;
    } else {
      // The send failed, so undo the lock and let the next run retry rather
      // than recording a reminder that never left the building (S176).
      await query(`DELETE FROM vendor_document_reminder WHERE id = $1`, [reserved[0].id]);
      summary.failures.push(`${r.display_name}/${r.doc_type}: ${result.error}`);
    }
  }

  return summary;
}
