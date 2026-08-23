"use server";

/**
 * Portal server actions: request a sign-in link, sign out, and vendor
 * submissions. The link request never reveals whether an address exists.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { query } from "../lib/db.ts";
import { activeTransport } from "../lib/notifications/transport.ts";
import {
  createLoginTokens,
  destroyPortalSession,
  getPortalContact,
} from "../lib/portal/auth.ts";

/** Public origin from forwarding headers; server actions carry no Request. */
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

export async function requestLoginLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  // Always land on the same confirmation, whatever happens below.
  if (!email || !email.includes("@")) redirect("/portal?sent=1");

  const origin = await portalOrigin();
  if (!origin) {
    console.error("[portal] cannot determine public origin; link not sent.");
    redirect("/portal?sent=1");
  }

  try {
    const tokens = await createLoginTokens(email);
    const transport = activeTransport();
    for (const { contact, token } of tokens) {
      const url = `${origin}/api/portal/auth?token=${token}`;
      await transport.send(contact.email, {
        subject: "Your P5 Home Co portal sign-in link",
        text:
          `Hello ${contact.fullName},\n\n` +
          `Use this link to sign in to the P5 Home Co ${contact.kind} portal. ` +
          `It works once and expires in 15 minutes.\n\n${url}\n\n` +
          `If you did not request this, you can ignore this email.`,
        html:
          `<p>Hello ${contact.fullName},</p>` +
          `<p>Use this link to sign in to the P5 Home Co ${contact.kind} portal. ` +
          `It works once and expires in 15 minutes.</p>` +
          `<p><a href="${url}">Sign in to the portal</a></p>` +
          `<p>If you did not request this, you can ignore this email.</p>`,
      });
    }
  } catch (error) {
    // Log and continue to the same confirmation - no information leak.
    console.error("[portal] login link error:", (error as Error).message);
  }
  redirect("/portal?sent=1");
}

export async function portalSignOut(): Promise<void> {
  await destroyPortalSession();
  redirect("/portal");
}

/**
 * Vendor submissions: invoice references, waiver confirmations, messages.
 * Recorded so nothing lives only in an inbox (S99), and surfaced to finance
 * through the admin portal page.
 */
export async function vendorSubmit(formData: FormData): Promise<void> {
  const contact = await getPortalContact();
  if (!contact || contact.kind !== "vendor") {
    throw new Error("Vendor session required.");
  }
  const kind = String(formData.get("kind") ?? "message");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("A message is required.");
  if (!["invoice_reference", "waiver_confirmation", "message"].includes(kind)) {
    throw new Error("Unknown submission kind.");
  }

  await query(
    `INSERT INTO portal_submission (contact_id, kind, reference, body)
     VALUES ($1, $2, $3, $4)`,
    [contact.id, kind, reference, body],
  );
  redirect("/portal/vendor?submitted=1");
}
