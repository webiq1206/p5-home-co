/**
 * Portal sign-in: request a one-time email link. The confirmation reads the
 * same whether or not the address is registered.
 */

import { redirect } from "next/navigation";

import { checkDatabase } from "../lib/db.ts";
import { getPortalContact } from "../lib/portal/auth.ts";
import { requestLoginLink } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const db = await checkDatabase();
  const params = await searchParams;

  if (db.ok) {
    const contact = await getPortalContact();
    if (contact) {
      redirect(contact.kind === "vendor" ? "/portal/vendor" : "/portal/client");
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <h1>P5 Home Co portal</h1>
        <p>
          Enter the email address P5 has on file. We&apos;ll send a sign-in
          link that works once and expires in 15 minutes.
        </p>
        {params.sent && (
          <p className="lead-ok">
            If that address is registered, a sign-in link is on its way.
          </p>
        )}
        {params.error && (
          <p className="lead-error-block lead-error">
            That link is no longer valid. Request a fresh one below.
          </p>
        )}
        {!db.ok ? (
          <p className="lead-error-block lead-error">
            The portal is temporarily unavailable. Please try again later.
          </p>
        ) : (
          <form action={requestLoginLink} className="lead-form">
            <label className="lead-field">
              <span>Email address</span>
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <button className="lead-action lead-action-primary" type="submit">
              Email me a sign-in link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
