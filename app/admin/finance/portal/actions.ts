"use server";

/**
 * Portal administration actions: invite, enable/disable, review submissions.
 * Finance-role gated, audited (S168, S174).
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getSessionUser, type SessionUser } from "../../../lib/auth.ts";
import { query } from "../../../lib/db.ts";
import { activeTransport } from "../../../lib/notifications/transport.ts";
import { createLoginTokens } from "../../../lib/portal/auth.ts";

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
): Promise<void> {
  await query(
    `INSERT INTO finance_audit (actor_id, action, object_kind, object_id, next)
     VALUES ($1,$2,'portal_contact',$3,$4::jsonb)`,
    [actorId, action, objectId, JSON.stringify(next)],
  );
}

async function portalOrigin(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwarded && !/^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\])/.test(forwarded)) {
    return `${proto}://${forwarded}`;
  }
  const host = h.get("host");
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\])/.test(host)) {
    return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  }
  return null;
}

export async function invitePortalContact(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const kind = String(formData.get("kind") ?? "");
  const vendorId = Number(formData.get("vendorId")) || null;
  const projectId = Number(formData.get("projectId")) || null;
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!fullName || !email.includes("@")) throw new Error("Name and email are required.");
  if (kind === "vendor" && !vendorId) throw new Error("Pick the vendor this contact belongs to.");
  if (kind === "client" && !projectId) throw new Error("Pick the project this client belongs to.");
  if (kind !== "vendor" && kind !== "client") throw new Error("Unknown contact kind.");

  await query(
    `INSERT INTO portal_contact (kind, vendor_id, project_id, email, full_name, invited_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (kind, email, vendor_id, project_id)
     DO UPDATE SET is_active = TRUE, full_name = EXCLUDED.full_name`,
    [
      kind,
      kind === "vendor" ? vendorId : null,
      kind === "client" ? projectId : null,
      email,
      fullName,
      user.id,
    ],
  );
  await audit(user.id, "portal_invite", email, { kind, vendorId, projectId, fullName });

  // Send the first sign-in link right away so the invite is one step.
  const origin = await portalOrigin();
  if (origin) {
    const tokens = await createLoginTokens(email);
    const transport = activeTransport();
    for (const { contact, token } of tokens) {
      const url = `${origin}/api/portal/auth?token=${token}`;
      await transport.send(contact.email, {
        subject: "Your P5 Home Co portal access",
        text:
          `Hello ${contact.fullName},\n\nP5 Home Co set up portal access for you. ` +
          `Sign in with this one-time link (expires in 15 minutes):\n\n${url}\n\n` +
          `You can request a fresh link any time at ${origin}/portal.`,
        html:
          `<p>Hello ${contact.fullName},</p>` +
          `<p>P5 Home Co set up portal access for you. ` +
          `<a href="${url}">Sign in with this one-time link</a> (expires in 15 minutes).</p>` +
          `<p>You can request a fresh link any time at <a href="${origin}/portal">${origin}/portal</a>.</p>`,
      });
    }
  }
  revalidatePath("/admin/finance/portal");
}

export async function setContactActive(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  if (!id) throw new Error("Contact id is required.");

  await query(`UPDATE portal_contact SET is_active = $2 WHERE id = $1`, [id, active]);
  // Disabling access also ends any live sessions immediately.
  if (!active) {
    await query(`DELETE FROM portal_session WHERE contact_id = $1`, [id]);
  }
  await audit(user.id, active ? "portal_enable" : "portal_disable", String(id), { active });
  revalidatePath("/admin/finance/portal");
}

export async function reviewSubmission(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  if (!id) throw new Error("Submission id is required.");
  await query(
    `UPDATE portal_submission SET reviewed_at = now(), reviewed_by = $2 WHERE id = $1`,
    [id, user.id],
  );
  await audit(user.id, "portal_submission_reviewed", String(id), null);
  revalidatePath("/admin/finance/portal");
}
