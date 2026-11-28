/** Internal release repository. Drafts and approval audit records never enter customer output. */
import { getSessionUser } from "../auth.ts";
import { queryOne, transaction } from "../db.ts";
import { PRICE_BOOK } from "../../../lib/p5/priceBook.ts";
import {
  digestPricingSnapshot, PricingReleaseValidationError, requireCatalogCompatibility,
  validPricingDigest, validPricingVersion, validatePricingSnapshot, type PricingSnapshot,
} from "../../../lib/p5/pricingRelease.ts";

export const P5_COST_BOOK_WORKBOOK_ID = "1DLwv_kKsbkKUkf-uevZQhKLtghys4rF9DUVQ1SDotc0";

export type ResolvedPricingRelease = {
  version: string; digest: string; snapshot: PricingSnapshot; generation: number | null;
};

type ReleaseRecord = { version: string; digest: string; snapshot: unknown };
type ActivatedRecord = ReleaseRecord & { generation: string };
type StagedRecord = ReleaseRecord & { source_workbook: string; source_revision: string };

export class PricingReleaseError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 503;
  constructor(status: 400 | 401 | 403 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = "PricingReleaseError";
    this.status = status;
  }
}

async function sessionAdministrator(): Promise<number> {
  const user = await getSessionUser();
  if (!user) throw new PricingReleaseError(401, "Sign in to P5 Admin.");
  if (!user.isActive || user.role !== "administrator" || !Number.isSafeInteger(user.id) || user.id < 1) {
    throw new PricingReleaseError(403, "Only a P5 administrator can stage or approve pricing.");
  }
  return user.id;
}

function resolved(row: ReleaseRecord | null, generation: number | null): ResolvedPricingRelease {
  if (!row) throw new PricingReleaseError(503, "No approved pricing release is available. No quote was produced.");
  if (!validPricingVersion(row.version) || !validPricingDigest(row.digest)) {
    throw new PricingReleaseError(503, "The approved pricing release receipt is invalid. No quote was produced.");
  }
  let snapshot: PricingSnapshot;
  try { snapshot = validatePricingSnapshot(row.snapshot); }
  catch { throw new PricingReleaseError(503, "The approved pricing release could not be verified. No quote was produced."); }
  if (digestPricingSnapshot(snapshot) !== row.digest) {
    throw new PricingReleaseError(503, "The approved pricing release digest did not match. No quote was produced.");
  }
  return {version: row.version, digest: row.digest, generation, snapshot};
}

function generationNumber(value: string | undefined) {
  const n = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new PricingReleaseError(503, "The pricing release generation is invalid.");
  return n;
}

/** Resolve once per pricing request and pass this exact snapshot to all consumers.
 * Use the stored version for replay. Never reprice a saved estimate from the current version.
 * Legacy, pre-versioned records require their existing legacy replay path, not a guess here.
 */
export async function loadPublishedPricingRelease(version?: string): Promise<ResolvedPricingRelease> {
  if (version !== undefined) {
    if (!validPricingVersion(version)) throw new PricingReleaseError(400, "The pricing version is invalid.");
    const row = await queryOne<ActivatedRecord>(
      `SELECT r.version, r.digest, r.snapshot, a.generation::text
         FROM p5_pricing_release_activation a
         JOIN p5_pricing_release r ON (r.version, r.digest) = (a.version, a.digest)
        WHERE a.version = $1 AND a.action = 'publish'
        ORDER BY a.generation DESC LIMIT 1`, [version]);
    if (!row) throw new PricingReleaseError(404, "This pricing version was not previously approved.");
    return resolved(row, generationNumber(row.generation));
  }
  const row = await queryOne<ActivatedRecord>(
    `SELECT r.version, r.digest, r.snapshot, a.generation::text
       FROM p5_pricing_release_activation a
       JOIN p5_pricing_release r ON (r.version, r.digest) = (a.version, a.digest)
      ORDER BY a.generation DESC LIMIT 1`);
  return resolved(row, generationNumber(row?.generation));
}

/** Required artifact contract for a workbook import. Caller must read the protected workbook
 * through a trusted server connector; a client-supplied revision is not workbook authentication.
 */
export async function stagePricingRelease(input: {
  version: string; snapshot: unknown; workbookId: string; workbookRevision: string;
}): Promise<{version: string; digest: string; alreadyStaged: boolean}> {
  const actor = await sessionAdministrator();
  if (!validPricingVersion(input.version) || input.workbookId !== P5_COST_BOOK_WORKBOOK_ID ||
      typeof input.workbookRevision !== "string" || !/^[A-Za-z0-9._:-]{3,200}$/.test(input.workbookRevision)) {
    throw new PricingReleaseError(400, "Provide a valid version and revision from the P5 Cost Book.");
  }
  const snapshot = validatePricingSnapshot(input.snapshot);
  requireCatalogCompatibility(snapshot, PRICE_BOOK);
  const digest = digestPricingSnapshot(snapshot);
  return transaction(async client => {
    const locked = await client.query<{id: string}>(
      `SELECT id::text FROM app_user
         WHERE id=$1 AND role='administrator' AND is_active
           AND NOT COALESCE((to_jsonb(app_user)->>'scopes_only')::boolean,false)
         FOR SHARE`, [actor]);
    if (!locked.rows.length) throw new PricingReleaseError(403, "The administrator authorization is no longer active.");
    const inserted = await client.query<{version:string}>(
      `INSERT INTO p5_pricing_release (version,digest,schema_version,snapshot,source_workbook,source_revision,staged_by)
       VALUES ($1,$2,1,$3::jsonb,$4,$5,$6)
       ON CONFLICT (version) DO NOTHING RETURNING version`,
      [input.version,digest,JSON.stringify(snapshot),input.workbookId,input.workbookRevision,actor]);
    if (inserted.rows.length) return {version: input.version,digest,alreadyStaged:false};
    const existing = (await client.query<StagedRecord>(
      `SELECT version,digest,snapshot,source_workbook,source_revision FROM p5_pricing_release WHERE version=$1`,
      [input.version])).rows[0];
    if (!existing || existing.digest !== digest || existing.source_workbook !== input.workbookId ||
        existing.source_revision !== input.workbookRevision) {
      throw new PricingReleaseError(409, "That version already identifies another release. Stage a new version.");
    }
    resolved(existing, null);
    return {version: input.version,digest,alreadyStaged:true};
  });
}

type ActivationInput = {
  action: "publish" | "rollback"; version: string; expectedDigest: string; expectedGeneration: number;
  reason: string; verificationReference: string;
};

/** Approve the exact previously reviewed digest, or roll back to a previously approved release.
 * A stale review loses rather than overwriting a concurrent change. The audit log is never
 * updated or deleted. The current pointer is always the latest committed activation event.
 */
export async function promotePricingRelease(input: ActivationInput): Promise<{version: string; digest: string; generation: number}> {
  const actor = await sessionAdministrator();
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const verification = typeof input.verificationReference === "string" ? input.verificationReference.trim() : "";
  if ((input.action !== "publish" && input.action !== "rollback") ||
      !validPricingVersion(input.version) || !validPricingDigest(input.expectedDigest) ||
      !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 ||
      reason.length < 8 || reason.length > 1000 || verification.length < 3 || verification.length > 500) {
    throw new PricingReleaseError(400, "Confirm the exact version, current generation, reason, and verification reference.");
  }
  return transaction(async client => {
    // Reserved two-key PostgreSQL lock namespace for P5 pricing releases.
    await client.query("SELECT pg_advisory_xact_lock(50325, 101)");
    const locked = await client.query<{id: string}>(
      `SELECT id::text FROM app_user
         WHERE id=$1 AND role='administrator' AND is_active
           AND NOT COALESCE((to_jsonb(app_user)->>'scopes_only')::boolean,false)
         FOR SHARE`, [actor]);
    if (!locked.rows.length) throw new PricingReleaseError(403, "The administrator authorization is no longer active.");
    const current = (await client.query<ActivatedRecord>(
      `SELECT r.version,r.digest,r.snapshot,a.generation::text
         FROM p5_pricing_release_activation a
         JOIN p5_pricing_release r ON (r.version,r.digest)=(a.version,a.digest)
        ORDER BY a.generation DESC LIMIT 1`)).rows[0];
    const generation = generationNumber(current?.generation);
    if (generation !== input.expectedGeneration || generation === Number.MAX_SAFE_INTEGER) {
      throw new PricingReleaseError(409, "The active pricing release changed. Refresh and review again.");
    }
    if (current?.version === input.version) {
      throw new PricingReleaseError(409, "This pricing version is already active.");
    }
    const row = (await client.query<ReleaseRecord>(
      `SELECT version,digest,snapshot FROM p5_pricing_release WHERE version=$1 FOR SHARE`, [input.version])).rows[0];
    if (!row) throw new PricingReleaseError(404, "That pricing version was not staged.");
    if (row.digest !== input.expectedDigest) {
      throw new PricingReleaseError(409, "The staged digest did not match the reviewed candidate.");
    }
    const selected = resolved(row,null);
    requireCatalogCompatibility(selected.snapshot, PRICE_BOOK);
    const previousApproval = (await client.query<{generation:string}>(
      `SELECT generation::text FROM p5_pricing_release_activation WHERE version=$1 AND action='publish' LIMIT 1`, [input.version])).rows[0];
    if (input.action === "rollback" && !previousApproval) {
      throw new PricingReleaseError(409, "Rollback can only restore a previously approved release.");
    }
    if (input.action === "publish" && previousApproval) {
      throw new PricingReleaseError(409, "Use rollback to restore an already approved version.");
    }
    // Do not silently drop a line added by an earlier live release. Rollback is the explicit exception.
    if (input.action === "publish" && current) {
      requireCatalogCompatibility(selected.snapshot, resolved(current,generation).snapshot.lines);
    }
    await client.query(
      `INSERT INTO p5_pricing_release_activation
        (generation,version,digest,previous_version,action,activated_by,reason,verification_reference)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [generation+1,selected.version,selected.digest,current?.version??null,input.action,actor,reason,verification]);
    return {version:selected.version,digest:selected.digest,generation:generation+1};
  });
}

export { PricingReleaseValidationError };
