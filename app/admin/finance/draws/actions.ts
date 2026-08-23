"use server";

/**
 * Lender draw actions (S77). Finance-role gated, audited (S168, S174).
 * Submission runs the readiness evaluation and refuses with the named
 * blockers when a lender requirement is unmet; the package snapshot freezes
 * at submission.
 */

import { revalidatePath } from "next/cache";

import { getSessionUser, type SessionUser } from "../../../lib/auth.ts";
import { query, queryOne } from "../../../lib/db.ts";
import {
  assembleDrawPackage,
  canTransitionDraw,
  drawFacts,
  evaluateDrawReadiness,
  type DrawStatus,
} from "../../../lib/finance/draws.ts";

async function requireFinanceUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || (user.role !== "administrator" && user.role !== "manager")) {
    throw new Error("Finance access requires an administrator or manager session.");
  }
  return user;
}

async function audit(
  actorId: number,
  action: string,
  objectId: string,
  next: unknown,
  reason: string | null = null,
): Promise<void> {
  await query(
    `INSERT INTO finance_audit (actor_id, action, object_kind, object_id, next, reason)
     VALUES ($1,$2,'lender_draw',$3,$4::jsonb,$5)`,
    [actorId, action, objectId, JSON.stringify(next), reason],
  );
}

export async function configureLender(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const projectId = Number(formData.get("projectId"));
  const lenderName = String(formData.get("lenderName") ?? "").trim();
  if (!projectId || !lenderName) throw new Error("Project and lender name are required.");

  const values = {
    loanNumber: String(formData.get("loanNumber") ?? "").trim() || null,
    contactName: String(formData.get("contactName") ?? "").trim() || null,
    contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
    approvedLoanBudget: Number(formData.get("approvedLoanBudget")) || null,
    requiresInspection: formData.get("requiresInspection") === "on",
    requiresLienWaivers: formData.get("requiresLienWaivers") === "on",
    requiresInvoices: formData.get("requiresInvoices") === "on",
    requiresPhotos: formData.get("requiresPhotos") === "on",
  };

  await query(
    `INSERT INTO project_lender
       (project_id, lender_name, loan_number, contact_name, contact_email,
        approved_loan_budget, requires_inspection, requires_lien_waivers,
        requires_invoices, requires_photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id) DO UPDATE SET
       lender_name=EXCLUDED.lender_name, loan_number=EXCLUDED.loan_number,
       contact_name=EXCLUDED.contact_name, contact_email=EXCLUDED.contact_email,
       approved_loan_budget=EXCLUDED.approved_loan_budget,
       requires_inspection=EXCLUDED.requires_inspection,
       requires_lien_waivers=EXCLUDED.requires_lien_waivers,
       requires_invoices=EXCLUDED.requires_invoices,
       requires_photos=EXCLUDED.requires_photos,
       updated_at=now()`,
    [
      projectId,
      lenderName,
      values.loanNumber,
      values.contactName,
      values.contactEmail,
      values.approvedLoanBudget,
      values.requiresInspection,
      values.requiresLienWaivers,
      values.requiresInvoices,
      values.requiresPhotos,
    ],
  );
  await audit(user.id, "lender_configure", `project:${projectId}`, { lenderName, ...values });
  revalidatePath("/admin/finance/draws");
}

export async function createDraw(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const projectId = Number(formData.get("projectId"));
  const amount = Number(formData.get("amount"));
  if (!projectId || !(amount > 0)) throw new Error("Project and a positive amount are required.");

  const lender = await queryOne<{ project_id: string; requires_inspection: boolean }>(
    `SELECT project_id, requires_inspection FROM project_lender WHERE project_id = $1`,
    [projectId],
  );
  if (!lender) throw new Error("Configure the project's lender before creating a draw.");

  const next = await queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(draw_number), 0) + 1 AS n FROM lender_draw WHERE project_id = $1`,
    [projectId],
  );
  const row = await queryOne<{ id: string }>(
    `INSERT INTO lender_draw
       (project_id, draw_number, amount_requested, inspection_status, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      projectId,
      next?.n ?? 1,
      amount,
      lender.requires_inspection ? "pending" : "not_required",
      user.id,
    ],
  );
  await audit(user.id, "draw_create", String(row?.id), { projectId, amount, drawNumber: next?.n });
  revalidatePath("/admin/finance/draws");
}

export async function updateDrawEvidence(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  const inspectionStatus = String(formData.get("inspectionStatus") ?? "");
  const photosRef = String(formData.get("photosRef") ?? "").trim() || null;
  if (!id) throw new Error("Draw id is required.");

  await query(
    `UPDATE lender_draw SET inspection_status = $2, photos_ref = $3, updated_at = now()
     WHERE id = $1 AND status IN ('draft','rejected')`,
    [id, inspectionStatus, photosRef],
  );
  await audit(user.id, "draw_evidence", String(id), { inspectionStatus, photosRef });
  revalidatePath("/admin/finance/draws");
}

export async function transitionDraw(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  const to = String(formData.get("to")) as DrawStatus;
  const amount = Number(formData.get("amount")) || null;
  if (!id || !to) throw new Error("Draw id and target status are required.");

  const draw = await queryOne<{ status: DrawStatus; project_id: string }>(
    `SELECT status, project_id FROM lender_draw WHERE id = $1`,
    [id],
  );
  if (!draw) throw new Error("Draw not found.");
  if (!canTransitionDraw(draw.status, to)) {
    throw new Error(`A ${draw.status} draw cannot move to ${to}.`);
  }

  if (to === "submitted") {
    // Readiness gate: refuse with named blockers (S77, same contract as S105).
    const lender = await queryOne<{
      requires_inspection: boolean;
      requires_lien_waivers: boolean;
      requires_invoices: boolean;
      requires_photos: boolean;
    }>(`SELECT * FROM project_lender WHERE project_id = $1`, [draw.project_id]);
    const facts = await drawFacts(id);
    if (!lender || !facts) throw new Error("Lender configuration or draw data missing.");
    const readiness = evaluateDrawReadiness(
      {
        requiresInspection: lender.requires_inspection,
        requiresLienWaivers: lender.requires_lien_waivers,
        requiresInvoices: lender.requires_invoices,
        requiresPhotos: lender.requires_photos,
      },
      facts,
    );
    if (!readiness.ready) {
      throw new Error(`Not ready to submit: ${readiness.blockers.join(" ")}`);
    }
    // Freeze the package as sent (S77).
    const pkg = await assembleDrawPackage(id);
    await query(
      `UPDATE lender_draw
       SET status='submitted', submitted_at=now(), package=$2::jsonb, updated_at=now()
       WHERE id = $1`,
      [id, JSON.stringify(pkg)],
    );
  } else if (to === "approved") {
    await query(
      `UPDATE lender_draw
       SET status='approved', approved_at=now(), amount_approved=$2, updated_at=now()
       WHERE id = $1`,
      [id, amount],
    );
  } else if (to === "funded") {
    await query(
      `UPDATE lender_draw
       SET status='funded', funded_at=now(),
           amount_funded=COALESCE($2, amount_approved, amount_requested), updated_at=now()
       WHERE id = $1`,
      [id, amount],
    );
  } else {
    await query(
      `UPDATE lender_draw SET status=$2, updated_at=now() WHERE id = $1`,
      [id, to],
    );
  }
  await audit(user.id, `draw_${to}`, String(id), { from: draw.status, amount });
  revalidatePath("/admin/finance/draws");
}
