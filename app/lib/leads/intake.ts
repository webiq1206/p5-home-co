/**
 * Lead intake.
 *
 * Every source -- website form, Facebook, phone, email, manual entry --
 * converges here, so duplicate handling, SLA start, assignment, and the first
 * task are decided in exactly one place.
 *
 * The whole ingest runs in a transaction: a lead is never half-created with a
 * contact but no deal, or a deal with no first task. Where two requests race,
 * the database's partial unique indexes decide the winner and the loser is
 * reported as a duplicate rather than raising an error.
 */

import type { PoolClient } from "pg";

import { isUniqueViolation, transaction } from "../db.ts";
import {
  contactIdentityKey,
  dealIdentityKey,
  dealName,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  validateInboundLead,
  type ValidationError,
} from "./normalize.ts";
import type { LeadManagerSettings } from "./settings.ts";
import { addBusinessMinutes, isWithinBusinessHours } from "./time.ts";
import type { InboundLead } from "./types.ts";

export type IntakeResult =
  | { status: "created"; dealId: number; contactId: number; ownerUserId: number | null; slaDeadline: Date }
  | { status: "duplicate"; dealId: number; contactId: number; reason: string }
  | { status: "rejected"; errors: ValidationError[] };

/**
 * Choose an owner for a new lead.
 *
 * Fewest open deals wins, among active lead coordinators, then managers. Ties
 * break on the lowest user id so the choice is deterministic and a replayed
 * intake assigns the same person. Returns null when nobody is eligible, which
 * the rules engine immediately flags as an unassigned lead rather than
 * silently leaving it to nobody.
 */
async function chooseOwner(client: PoolClient): Promise<number | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT u.id
       FROM app_user u
       LEFT JOIN deal d
         ON d.owner_user_id = u.id
        AND d.stage NOT IN ('Closed Won','Closed Lost')
      WHERE u.is_active
        AND u.role IN ('lead_coordinator','manager')
      GROUP BY u.id, u.role
      ORDER BY COUNT(d.id) ASC,
               CASE u.role WHEN 'lead_coordinator' THEN 0 ELSE 1 END,
               u.id ASC
      LIMIT 1`,
  );
  return rows.length ? Number(rows[0].id) : null;
}

/** Insert or update the person, returning their id. */
async function upsertContact(
  client: PoolClient,
  lead: InboundLead,
  identityKey: string,
): Promise<number> {
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);
  const firstName = normalizeText(lead.firstName);
  const lastName = normalizeText(lead.lastName);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO contact (identity_key, first_name, last_name, email, phone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (identity_key) DO UPDATE SET
       -- Never overwrite a known value with null: a terse later form
       -- submission must not erase details we already hold.
       first_name = COALESCE(EXCLUDED.first_name, contact.first_name),
       last_name  = COALESCE(EXCLUDED.last_name,  contact.last_name),
       email      = COALESCE(EXCLUDED.email,      contact.email),
       phone      = COALESCE(EXCLUDED.phone,      contact.phone),
       updated_at = now()
     RETURNING id`,
    [identityKey, firstName, lastName, email, phone],
  );
  return Number(rows[0].id);
}

/** Find an existing deal that this submission should attach to instead. */
async function findExistingDeal(
  client: PoolClient,
  externalLeadId: string | null,
  dedupKey: string | null,
): Promise<{ id: number; reason: string } | null> {
  if (externalLeadId) {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM deal WHERE external_lead_id = $1",
      [externalLeadId],
    );
    if (rows.length) {
      return { id: Number(rows[0].id), reason: "Already imported from the same source lead id." };
    }
  }

  if (dedupKey) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM deal
        WHERE dedup_key = $1 AND stage NOT IN ('Closed Won','Closed Lost')`,
      [dedupKey],
    );
    if (rows.length) {
      return { id: Number(rows[0].id), reason: "An open deal already exists for this project." };
    }
  }

  return null;
}

async function audit(
  client: PoolClient,
  entry: {
    recordType: string;
    recordId: string;
    action: string;
    newValue?: unknown;
    source: string;
    integration?: string | null;
    succeeded?: boolean;
    error?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (record_type, record_id, action, new_value, action_source, integration_source, succeeded, error)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
    [
      entry.recordType,
      entry.recordId,
      entry.action,
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      entry.source,
      entry.integration ?? null,
      entry.succeeded ?? true,
      entry.error ?? null,
    ],
  );
}

/**
 * Ingest one lead.
 *
 * `actorUserId` is set for manual and phone entry, and null for automated
 * sources, so the audit trail distinguishes "an employee typed this in" from
 * "a form posted it".
 */
export async function ingestLead(
  lead: InboundLead,
  settings: LeadManagerSettings,
  actorUserId: number | null = null,
): Promise<IntakeResult> {
  const errors = validateInboundLead(lead);
  if (errors.length) return { status: "rejected", errors };

  const identityKey = contactIdentityKey(lead);
  if (!identityKey) {
    return {
      status: "rejected",
      errors: [{ field: "contact", message: "Enter an email address or a phone number." }],
    };
  }

  const dedupKey = dealIdentityKey(lead);
  const slaDeadline = addBusinessMinutes(
    lead.receivedAt,
    settings.firstResponseTargetMinutes,
    settings.calendar,
  );
  const arrivedInHours = isWithinBusinessHours(lead.receivedAt, settings.calendar);

  try {
    return await transaction(async (client) => {
      const contactId = await upsertContact(client, lead, identityKey);

      const existing = await findExistingDeal(client, lead.externalLeadId, dedupKey);
      if (existing) {
        // Record the repeat contact on the existing deal so the timeline shows
        // the customer reached out again, without creating a second deal.
        await client.query(
          `INSERT INTO activity (deal_id, kind, body, occurred_at, is_human_attempt)
           VALUES ($1, 'form', $2, $3, FALSE)`,
          [
            existing.id,
            `Duplicate ${lead.source} submission received. ${lead.summary ?? ""}`.trim(),
            lead.receivedAt,
          ],
        );
        await audit(client, {
          recordType: "deal",
          recordId: String(existing.id),
          action: "duplicate_submission_ignored",
          newValue: { source: lead.source, externalLeadId: lead.externalLeadId },
          source: "intake",
        });
        return {
          status: "duplicate" as const,
          dealId: existing.id,
          contactId,
          reason: existing.reason,
        };
      }

      const ownerUserId = await chooseOwner(client);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO deal (
           contact_id, name, brand, project_type, stage, lead_source, lead_source_detail,
           property_address, property_city, summary, owner_user_id,
           received_at, sla_deadline, sla_status,
           dedup_key, external_lead_id, original_form, original_campaign,
           facebook_lead_id, utm
         ) VALUES (
           $1,$2,$3,$4,'New Lead',$5,$6,
           $7,$8,$9,$10,
           $11,$12,$13,
           $14,$15,$16,$17,
           $18,$19::jsonb
         ) RETURNING id`,
        [
          contactId,
          dealName(lead),
          lead.brand,
          normalizeText(lead.projectType),
          lead.source,
          normalizeText(lead.sourceDetail),
          normalizeText(lead.propertyAddress),
          normalizeText(lead.propertyCity),
          normalizeText(lead.summary),
          ownerUserId,
          lead.receivedAt,
          slaDeadline,
          arrivedInHours ? "on_track" : "after_hours",
          dedupKey,
          lead.externalLeadId,
          normalizeText(lead.originalForm),
          normalizeText(lead.originalCampaign),
          lead.source === "Facebook Lead Ad" ? lead.externalLeadId : null,
          lead.utm ? JSON.stringify(lead.utm) : null,
        ],
      );
      const dealId = Number(rows[0].id);

      // The form submission itself is timeline evidence, but it is not a human
      // attempt, so it must not stop the response clock.
      await client.query(
        `INSERT INTO activity (deal_id, kind, body, occurred_at, is_human_attempt)
         VALUES ($1, 'form', $2, $3, FALSE)`,
        [dealId, lead.summary ?? `${lead.source} lead received.`, lead.receivedAt],
      );

      // The first action, carrying a stable rule_key so a replay reuses it.
      await client.query(
        `INSERT INTO task (deal_id, assigned_to, title, due_at, rule_key)
         VALUES ($1, $2, $3, $4, 'first_contact')
         ON CONFLICT (deal_id, rule_key) WHERE completed_at IS NULL AND rule_key IS NOT NULL DO NOTHING`,
        [dealId, ownerUserId, "Make first contact", slaDeadline],
      );

      await client.query(
        "UPDATE deal SET next_action = $2, next_action_at = $3 WHERE id = $1",
        [dealId, "Make first contact", slaDeadline],
      );

      await audit(client, {
        recordType: "deal",
        recordId: String(dealId),
        action: "lead_created",
        newValue: {
          brand: lead.brand,
          source: lead.source,
          ownerUserId,
          slaDeadline: slaDeadline.toISOString(),
          arrivedInBusinessHours: arrivedInHours,
          actorUserId,
        },
        source: actorUserId ? "admin_ui" : "intake",
      });

      return { status: "created" as const, dealId, contactId, ownerUserId, slaDeadline };
    });
  } catch (error) {
    // Two concurrent submissions of the same lead: the index rejected the
    // second. That is the correct outcome, reported as a duplicate.
    if (isUniqueViolation(error)) {
      return {
        status: "duplicate",
        dealId: -1,
        contactId: -1,
        reason: "A matching lead was created concurrently.",
      };
    }
    throw error;
  }
}
