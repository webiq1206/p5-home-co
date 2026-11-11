/**
 * Sign-in for the scope platform. Separate from the admin sign-in so people
 * with scopes-only access have their own front door and land on /scopes.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getScopeUser } from "../../lib/auth.ts";
import { isDatabaseConfigured } from "../../lib/db.ts";
import "../../admin/admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "P5 Scopes sign in", robots: { index: false, follow: false, nocache: true } };

const ERRORS: Record<string, string> = {
  unconfigured: "Sign-in is not set up on this deployment yet.",
  callbackurl: "Sign-in could not start. Tell an administrator.",
  cancelled: "Sign-in was cancelled.",
  invalid: "That sign-in link was incomplete. Try again.",
  state: "That sign-in attempt expired. Try again.",
  exchange: "Google could not confirm the sign-in. Try again.",
  identity: "Google did not return a usable account.",
  domain: "That Google account has not been given access. Use the email address P5 added for you.",
  notinvited: "That account has not been given access. Ask P5 to add you.",
  disabled: "That account has been deactivated.",
};

export default async function ScopesLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (isDatabaseConfigured()) {
    const user = await getScopeUser();
    if (user) redirect("/scopes");
  }
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;
  return (
    <div className="admin-body">
      <div className="admin-login">
        <div className="admin-login-card">
          <h1>P5 Scopes</h1>
          <p>Sign in with the Google account P5 gave access to.</p>
          {message && <div className="admin-notice admin-notice-error">{message}</div>}
          <a className="lead-action lead-action-primary" href="/api/auth/google?next=scopes">
            Continue with Google
          </a>
        </div>
      </div>
    </div>
  );
}
