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
import {SYNTHETIC_ESTIMATOR_FORM,estimatorDeliveryMode} from "./synthetic-qa.ts";

import { isUniqueViolation, query, transaction } from "../db.ts";
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
import type { Brand, InboundLead, LeadFileLink, RequestKind } from "./types.ts";
import { detailsBlock, detailsFingerprint, detailLines, hasAnyDetail, isUnsureProject, type LeadDetails } from "./intakeContract.ts";
import { submittedFieldsFingerprint } from "./submittedFields.ts";
import { isMetaLead } from "./meta-contact.ts";

class IntakeIdentityReviewError extends Error {}

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
  const email = normalizeEmail(lead.email) ?? (isMetaLead(lead) ? lead.email : null);
  const phone = normalizePhone(lead.phone) ?? (isMetaLead(lead) ? lead.phone : null);
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
  brandRef: { brand: Brand; externalId: string } | null = null,
): Promise<{ id: number; reason: string } | null> {
  if (brandRef) {
    const { rows } = await client.query<{ deal_id: string }>(
      "SELECT deal_id FROM lead_external_ref WHERE brand = $1 AND external_id = $2",
      [brandRef.brand, brandRef.externalId],
    );
    if (rows.length) {
      return { id: Number(rows[0].deal_id), reason: "Already received with the same brand request id." };
    }
  }

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

/** Remember a brand's own request id for this deal. Idempotent. */
async function recordExternalRef(
  client: PoolClient,
  ref: { brand: Brand; externalId: string },
  dealId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO lead_external_ref (brand, external_id, deal_id) VALUES ($1, $2, $3)
     ON CONFLICT (brand, external_id) DO NOTHING`,
    [ref.brand, ref.externalId, dealId],
  );
}

/**
 * Keep every field the submission carried, once per distinct submission.
 * Returns true when this submission is new (and so needs a HubSpot note).
 */
async function recordSubmission(client: PoolClient, dealId: number, lead: InboundLead): Promise<boolean> {
  const fields = lead.submittedFields ?? [];
  if (!fields.length) return false;
  const channel = lead.submissionChannel ?? lead.source;
  const { rows } = await client.query(
    `INSERT INTO lead_intake_submission (deal_id, fingerprint, channel, fields, received_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (deal_id, fingerprint) DO NOTHING
     RETURNING id`,
    [dealId, submittedFieldsFingerprint(channel, fields), channel, JSON.stringify(fields), lead.receivedAt],
  );
  return rows.length > 0;
}

/** Keep links to files a brand site stored. Returns how many were new. */
async function addFileLinks(client: PoolClient, dealId: number, files: readonly LeadFileLink[]): Promise<number> {
  let added = 0;
  for (const file of files) {
    const { rows } = await client.query(
      `INSERT INTO lead_file_link (deal_id, url, file_name, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (deal_id, url) DO NOTHING
       RETURNING id`,
      [dealId, file.url, file.name, file.contentType, file.size],
    );
    added += rows.length;
  }
  return added;
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
  options: {estimatorDeliveryMode?:'live'|'synthetic_qa'} = {},
): Promise<IntakeResult> {
  const errors = validateInboundLead(lead);
  if (errors.length) return { status: "rejected", errors };

  const estimator=options.estimatorDeliveryMode!==undefined;
  const synthetic=options.estimatorDeliveryMode==='synthetic_qa';
  if(estimator&&(!lead.externalLeadId||lead.originalForm!=='p5-estimator'))throw Error('Estimator intake requires its durable source identity');
  if(synthetic&&(estimatorDeliveryMode([lead.firstName,lead.lastName].filter(Boolean).join(' '),lead.email||'')!=='synthetic_qa'||!lead.externalLeadId?.startsWith('qa-')))
    throw Error('Synthetic estimator intake identity is invalid');
  // A QA contact must never rename or attach to an existing real customer.
  // Never merge unrelated people on malformed contact strings. The durable Meta
  // lead ID is the fallback identity when neither contact method normalizes.
  const identityKey = synthetic?'synthetic:'+lead.externalLeadId:
    contactIdentityKey(lead) ?? (isMetaLead(lead) ? `meta-lead:${lead.externalLeadId}` : null);
  if (!identityKey) {
    return {
      status: "rejected",
      errors: [{ field: "contact", message: "Enter an email address or a phone number." }],
    };
  }

  const dedupKey = estimator?'p5-estimator:'+lead.externalLeadId:dealIdentityKey(lead);
  const slaDeadline = addBusinessMinutes(
    lead.receivedAt,
    settings.firstResponseTargetMinutes,
    settings.calendar,
  );
  const arrivedInHours = isWithinBusinessHours(lead.receivedAt, settings.calendar);

  try {
    return await transaction(async (client) => {
      const brandRef = lead.brandExternalId ? { brand: lead.brand, externalId: lead.brandExternalId } : null;
      // Resolve immutable event identity before touching contact data. Replays may
      // carry the rejected address that an administrator has since corrected.
      let existing = await findExistingDeal(client, lead.externalLeadId, dedupKey, brandRef);
      let contactId: number;
      if (existing) {
        const { rows } = await client.query<{ contact_id: string; identity_key:string; corrected:boolean }>(
          `SELECT c.id AS contact_id,c.identity_key,EXISTS (
            SELECT 1 FROM audit_log a WHERE a.record_type='contact' AND a.record_id=c.id::text
              AND a.action='rejected_email_corrected') AS corrected
           FROM deal d JOIN contact c ON c.id=d.contact_id WHERE d.id=$1 FOR UPDATE OF c`, [existing.id]);
        contactId = Number(rows[0].contact_id);
        // Keep ordinary same-person refresh behavior. A corrected or mismatched
        // identity is never overwritten, replaced or relinked by a replay.
        if (!rows[0].corrected && rows[0].identity_key === identityKey) {
          const refreshedId = await upsertContact(client, lead, identityKey);
          if (refreshedId !== contactId) throw new IntakeIdentityReviewError('Contact identity changed during intake. Review the existing lead before resubmitting.');
        }
      } else {
        contactId = await upsertContact(client, lead, identityKey);
        existing = await findExistingDeal(client, lead.externalLeadId, dedupKey, brandRef);
        if (existing) {
          const { rows } = await client.query<{ contact_id:string }>('SELECT contact_id FROM deal WHERE id=$1',[existing.id]);
          if (Number(rows[0].contact_id) !== contactId) throw new IntakeIdentityReviewError('A matching request changed during intake. Reload and review the existing lead before resubmitting.');
        }
        // Only corrected contacts need this fallback. Preserve historical keys,
        // and match the exact same opportunity using the normal key function.
        if (!existing && !estimator) {
          const { rows } = await client.query<{ id: string; brand: Brand; project_type: string | null; property_address: string | null }>(
            `SELECT d.id,d.brand,d.project_type,d.property_address FROM deal d
             WHERE d.contact_id=$1 AND d.brand=$2 AND d.stage NOT IN ('Closed Won','Closed Lost')
               AND d.original_form IS DISTINCT FROM 'p5-estimator'
               AND d.original_form IS DISTINCT FROM $3
               AND COALESCE(d.dedup_key,'') NOT LIKE 'p5-estimator:%'
               AND EXISTS (SELECT 1 FROM audit_log a WHERE a.record_type='contact'
                 AND a.record_id=$1::text AND a.action='rejected_email_corrected')
             ORDER BY d.id FOR UPDATE`, [contactId,lead.brand,SYNTHETIC_ESTIMATOR_FORM]);
          const matches = rows.filter(d => dealIdentityKey({email:lead.email,phone:lead.phone,brand:d.brand,projectType:d.project_type,propertyAddress:d.property_address}) === dedupKey);
          if (matches.length === 1) existing = {id:Number(matches[0].id),reason:'An open deal already exists for this corrected contact and project.'};
          // Ambiguous matches require human review, not a third opportunity.
          if (matches.length > 1) throw new IntakeIdentityReviewError('Multiple open projects match this corrected contact. Review existing leads before resubmitting.');
        }
      }
      if (existing) {
        // A repeat request that attaches to an open deal keeps its own id, so
        // its Step 2 still finds this deal, and its files are kept, never lost.
        if (brandRef) await recordExternalRef(client, brandRef, existing.id);
        const newSubmission = await recordSubmission(client, existing.id, lead);
        if ((await addFileLinks(client, existing.id, lead.files ?? [])) || newSubmission) {
          await client.query(
            "UPDATE deal SET integration_sync_status = 'pending', updated_at = now() WHERE id = $1 AND original_form IS DISTINCT FROM $2",
            [existing.id, SYNTHETIC_ESTIMATOR_FORM],
          );
        }
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

      const ownerUserId = synthetic?null:await chooseOwner(client);

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
          isMetaLead(lead)
            ? `${lead.utm?.meta_test_lead === "true" ? "TEST LEAD — " : ""}${lead.brand} lead: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "New contact"}`
            : dealName(lead),
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
          synthetic?SYNTHETIC_ESTIMATOR_FORM:normalizeText(lead.originalForm),
          normalizeText(lead.originalCampaign),
          lead.source === "Facebook Lead Ad" ? lead.externalLeadId : null,
          lead.utm ? JSON.stringify(lead.utm) : null,
        ],
      );
      const dealId = Number(rows[0].id);
      // The two-step form fields (migration 021). A caller that sends none of
      // them runs exactly the SQL it ran before.
      const requestFacts = [lead.requestKind ?? null, lead.contactPreference ?? null, normalizeText(lead.bestTime ?? null), normalizeText(lead.timeline ?? null)];
      if (requestFacts.some((value) => value !== null)) {
        await client.query(
          "UPDATE deal SET request_kind = $2, contact_preference = $3, best_time = $4, timeline = $5 WHERE id = $1",
          [dealId, ...requestFacts],
        );
      }
      // State and ZIP (migration 022). A caller that sends neither runs exactly
      // the SQL it ran before.
      const place = [normalizeText(lead.propertyState ?? null), normalizeText(lead.propertyZip ?? null)];
      if (place.some((value) => value !== null)) {
        await client.query("UPDATE deal SET property_state = $2, property_zip = $3 WHERE id = $1", [dealId, ...place]);
      }
      if (brandRef) await recordExternalRef(client, brandRef, dealId);
      await addFileLinks(client, dealId, lead.files ?? []);
      await recordSubmission(client, dealId, lead);

      // The form submission itself is timeline evidence, but it is not a human
      // attempt, so it must not stop the response clock.
      await client.query(
        `INSERT INTO activity (deal_id, kind, body, occurred_at, is_human_attempt)
         VALUES ($1, 'form', $2, $3, FALSE)`,
        [dealId, lead.summary ?? `${lead.source} lead received.`, lead.receivedAt],
      );

      // Synthetic acceptance records retain intake evidence without outreach.
      if(!synthetic){
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

      }
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
          estimatorDeliveryMode:options.estimatorDeliveryMode||null,
          downstreamSuppressed:synthetic,
        },
        source: actorUserId ? "admin_ui" : "intake",
      });

      return { status: "created" as const, dealId, contactId, ownerUserId, slaDeadline };
    });
  } catch (error) {
    if (error instanceof IntakeIdentityReviewError) return {status:'rejected',errors:[{field:'contact',message:error.message}]};
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

export type DetailsTarget = { dealId: number } | { brand: Brand; externalId: string };

export type MergeResult =
  | {
      status: "merged";
      dealId: number;
      /** Deal fields that were empty (or "not sure") and are now filled. */
      filled: string[];
      /** The brand after the merge; differs from before only when rerouted. */
      brand: Brand;
      reroutedFrom: Brand | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
      projectType: string | null;
      lines: string[];
    }
  | { status: "duplicate"; dealId: number }
  | { status: "not_found" }
  | { status: "empty" };

type MergeRow = {
  id: string;
  name: string;
  brand: Brand;
  project_type: string | null;
  property_address: string | null;
  property_city: string | null;
  timeline: string | null;
  best_time: string | null;
  contact_preference: string | null;
  request_kind: string | null;
  summary: string | null;
  original_form: string | null;
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Merge a Step 2 ("add details") submission into the lead it belongs to.
 *
 * - Fills only what is empty: address, city, timing, best time to call and
 *   contact preference never overwrite an answer, and a project type replaces
 *   only a blank or "not sure" one. The contact's email is added only when the
 *   contact has none.
 * - Everything the visitor sent is kept: the summary gains a "Details added"
 *   block, the timeline gains a form entry, and file links are appended.
 * - Idempotent: the same details posted twice change nothing the second time.
 * - Marks the deal for HubSpot re-sync, which updates the deal and adds a note.
 *
 * `reroute` lets P5's own form send a "not sure" lead to the company that owns
 * the project type the visitor picked in Step 2. Brand posts never reroute.
 */
export async function mergeLeadDetails(
  target: DetailsTarget,
  details: LeadDetails,
  options: {
    receivedAt?: Date;
    reroute?: (projectType: string) => Brand | null;
    /** First line of the summary block; a late Step 1 says so instead of "Details added:". */
    heading?: string;
    /** A late Step 1 also carries the request kind; it fills only a blank one. */
    requestKind?: RequestKind | null;
  } = {},
): Promise<MergeResult> {
  if (!hasAnyDetail(details)) return { status: "empty" };
  const receivedAt = options.receivedAt ?? new Date();

  return transaction(async (client) => {
    let dealId: number | null = null;
    if ("dealId" in target) {
      dealId = Number.isInteger(target.dealId) && target.dealId > 0 ? target.dealId : null;
    } else {
      const { rows } = await client.query<{ deal_id: string }>(
        "SELECT deal_id FROM lead_external_ref WHERE brand = $1 AND external_id = $2",
        [target.brand, target.externalId],
      );
      dealId = rows.length ? Number(rows[0].deal_id) : null;
    }
    if (!dealId) return { status: "not_found" as const };

    const { rows } = await client.query<MergeRow>(
      `SELECT d.id, d.name, d.brand, d.project_type, d.property_address, d.property_city,
              d.timeline, d.best_time, d.contact_preference, d.request_kind, d.summary, d.original_form,
              d.contact_id, c.first_name, c.last_name, c.email, c.phone
         FROM deal d JOIN contact c ON c.id = d.contact_id
        WHERE d.id = $1
        FOR UPDATE OF d`,
      [dealId],
    );
    if (!rows.length) return { status: "not_found" as const };
    const row = rows[0];

    const fingerprint = detailsFingerprint(details);
    const inserted = await client.query(
      `INSERT INTO lead_details_event (deal_id, fingerprint, details, received_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (deal_id, fingerprint) DO NOTHING
       RETURNING deal_id`,
      [dealId, fingerprint, JSON.stringify(details), receivedAt],
    );
    if (!inserted.rows.length) return { status: "duplicate" as const, dealId };

    const filled: string[] = [];
    const next = {
      brand: row.brand,
      projectType: row.project_type,
      address: row.property_address,
      city: row.property_city,
      timeline: row.timeline,
      bestTime: row.best_time,
      contactPreference: row.contact_preference,
    };
    const project = normalizeText(details.projectType);
    if (project && isUnsureProject(row.project_type) && !isUnsureProject(project)) {
      next.projectType = project;
      filled.push("project_type");
      const routed = options.reroute?.(project) ?? null;
      if (routed && routed !== row.brand && row.brand === "P5 Home Co") {
        next.brand = routed;
        filled.push("brand");
      }
    }
    const fill = (key: "address" | "city" | "timeline" | "bestTime" | "contactPreference", column: string, value: string | null) => {
      const clean = normalizeText(value);
      if (clean && !normalizeText(next[key])) {
        next[key] = clean;
        filled.push(column);
      }
    };
    fill("address", "property_address", details.propertyAddress);
    fill("city", "property_city", details.propertyCity);
    fill("timeline", "timeline", details.timeline);
    fill("bestTime", "best_time", details.bestTime);
    fill("contactPreference", "contact_preference", details.contactPreference);

    // A deal name nobody edited follows the facts it was built from.
    const before = dealName({ firstName: row.first_name, lastName: row.last_name, brand: row.brand, projectType: row.project_type, propertyCity: row.property_city });
    const name = row.name === before
      ? dealName({ firstName: row.first_name, lastName: row.last_name, brand: next.brand, projectType: next.projectType, propertyCity: next.city })
      : row.name;

    const requestKind = !row.request_kind && options.requestKind ? options.requestKind : row.request_kind;
    if (requestKind !== row.request_kind) filled.push("request_kind");
    const block = detailsBlock(details, options.heading);
    const synthetic = row.original_form === SYNTHETIC_ESTIMATOR_FORM;
    await client.query(
      `UPDATE deal SET
         brand = $2, project_type = $3, property_address = $4, property_city = $5,
         timeline = $6, best_time = $7, contact_preference = $8, name = $9, request_kind = $12,
         summary = CASE WHEN summary IS NULL OR summary = '' THEN $10 ELSE summary || E'\\n\\n' || $10 END,
         integration_sync_status = CASE WHEN $11 THEN integration_sync_status ELSE 'pending' END,
         updated_at = now()
       WHERE id = $1`,
      [dealId, next.brand, next.projectType, next.address, next.city, next.timeline, next.bestTime, next.contactPreference, name, block, synthetic, requestKind],
    );

    let email = row.email;
    const newEmail = normalizeEmail(details.email);
    if (newEmail && !row.email) {
      await client.query("UPDATE contact SET email = $2, updated_at = now() WHERE id = $1 AND email IS NULL", [row.contact_id, newEmail]);
      email = newEmail;
      filled.push("email");
    }

    await addFileLinks(client, dealId, details.files);

    await client.query(
      `INSERT INTO activity (deal_id, kind, body, occurred_at, is_human_attempt)
       VALUES ($1, 'form', $2, $3, FALSE)`,
      [dealId, block, receivedAt],
    );
    await audit(client, {
      recordType: "deal",
      recordId: String(dealId),
      action: "details_added",
      newValue: { filled, files: details.files.length, fingerprint },
      source: "intake",
    });

    return {
      status: "merged" as const,
      dealId,
      filled,
      brand: next.brand,
      reroutedFrom: next.brand !== row.brand ? row.brand : null,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      email,
      projectType: next.projectType,
      lines: detailLines(details),
    };
  });
}

/**
 * The fingerprint of what Step 1 itself said, so a repeat of the same Step 1
 * stays a plain duplicate. State 'initial' means it never becomes a HubSpot
 * note: Step 1 is already the deal. Best effort; a miss only means a repeat
 * Step 1 would add its words once more.
 */
export async function recordInitialFingerprint(dealId: number, details: LeadDetails): Promise<void> {
  await query(
    `INSERT INTO lead_details_event (deal_id, fingerprint, details, hubspot_note_state)
     VALUES ($1, $2, $3::jsonb, 'initial')
     ON CONFLICT (deal_id, fingerprint) DO NOTHING`,
    [dealId, detailsFingerprint(details), JSON.stringify(details)],
  ).catch((error: Error) => console.error("[intake] initial fingerprint not recorded:", error.message));
}

/**
 * Merge every Step 2 that arrived before its Step 1, now that a deal carries
 * this brand + external_id. Each is merged (idempotently) and then removed.
 */
export async function applyPendingDetails(brand: Brand, externalId: string): Promise<MergeResult[]> {
  const pending = await query<{ fingerprint: string; details: LeadDetails; received_at: Date }>(
    `SELECT fingerprint, details, received_at FROM lead_pending_details
      WHERE brand = $1 AND external_id = $2 ORDER BY received_at`,
    [brand, externalId],
  );
  const results: MergeResult[] = [];
  for (const row of pending) {
    const details: LeadDetails = { ...row.details, files: row.details.files ?? [] };
    const result = await mergeLeadDetails({ brand, externalId }, details, { receivedAt: new Date(row.received_at) });
    if (result.status === "not_found") break;
    results.push(result);
    await query("DELETE FROM lead_pending_details WHERE brand = $1 AND external_id = $2 AND fingerprint = $3", [brand, externalId, row.fingerprint]);
  }
  return results;
}

/**
 * Hold a Step 2 whose Step 1 has not arrived and that carries no way to reach
 * the person on its own. Never dropped: it merges when Step 1 lands. The
 * check after the insert closes the race with a Step 1 committing meanwhile.
 */
export async function holdPendingDetails(
  brand: Brand,
  externalId: string,
  details: LeadDetails,
): Promise<{ status: "held" } | { status: "applied"; results: MergeResult[] }> {
  await query(
    `INSERT INTO lead_pending_details (brand, external_id, fingerprint, details)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (brand, external_id, fingerprint) DO NOTHING`,
    [brand, externalId, detailsFingerprint(details), JSON.stringify(details)],
  );
  const ref = await query("SELECT 1 FROM lead_external_ref WHERE brand = $1 AND external_id = $2", [brand, externalId]);
  if (!ref.length) return { status: "held" };
  return { status: "applied", results: await applyPendingDetails(brand, externalId) };
}
