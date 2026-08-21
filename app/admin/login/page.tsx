/**
 * Admin sign-in.
 *
 * Google Workspace is the intended identity provider, restricted to approved
 * P5 domains and to users already present in app_user. Until the OAuth client
 * exists, this page says so plainly rather than offering a weaker fallback.
 */

import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import { isDatabaseConfigured } from "../../lib/db.ts";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isDatabaseConfigured()) {
    const user = await getSessionUser();
    if (user) redirect("/admin");
  }

  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <h1>P5 Lead Manager</h1>
        <p>Sign in with your P5 Google Workspace account.</p>

        {googleConfigured ? (
          <a className="lead-action lead-action-primary" href="/api/auth/google">
            Continue with Google
          </a>
        ) : (
          <div className="admin-notice admin-notice-error">
            <strong>Sign-in is not configured yet.</strong>
            Create a Google OAuth client for this app and set GOOGLE_CLIENT_ID and
            GOOGLE_CLIENT_SECRET in the host&rsquo;s secrets. Only approved P5 Workspace
            users will be able to sign in.
          </div>
        )}
      </div>
    </div>
  );
}
