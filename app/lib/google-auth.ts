/**
 * Google Workspace sign-in helpers.
 *
 * The pure parts live here so the security decisions -- who is allowed in, and
 * what a valid token looks like -- are testable without a network round trip.
 * The routes do the redirecting and cookie setting.
 *
 * Two rules govern access, and both must pass:
 *
 *   1. The email must be on an approved P5 domain and verified by Google.
 *   2. The person must already exist and be active in app_user.
 *
 * The second is what makes this an allowlist rather than open registration.
 * Anyone at an approved domain could otherwise create themselves an account
 * simply by signing in, which is not the same as being given access.
 */

/** Domains whose users may sign in, assuming they are also in app_user. */
export const APPROVED_SIGN_IN_DOMAINS = [
  "p5homeco.com",
  "boiseconstruction.co",
  "boiseremodeling.co",
  "boisehandyman.co",
  "boiseadu.co",
  "boisecabinet.co",
] as const;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Only what is needed to identify the person. No mail or calendar scope. */
export const GOOGLE_SCOPES = ["openid", "email", "profile"] as const;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The redirect URI Google will send the browser back to.
 *
 * Derived from the incoming request so the same build works on the Replit URL
 * and the live domain, but an explicit env var wins when set, because Google
 * requires an exact match against the registered value.
 */
export function redirectUriFor(requestUrl: string): string {
  const override = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (override) return override;
  return new URL("/api/auth/google/callback", new URL(requestUrl).origin).toString();
}

/** Domain part of an email, lowercased. Null when it is not an address. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

export function isApprovedDomain(email: string): boolean {
  const domain = domainOf(email);
  return domain !== null && (APPROVED_SIGN_IN_DOMAINS as readonly string[]).includes(domain);
}

/** The subset of Google's id_token payload this app relies on. */
export type GoogleIdentity = {
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** Google Workspace hosted domain, when the account belongs to one. */
  hostedDomain: string | null;
};

export type IdentityRejection = { reason: string };

/**
 * Decode the id_token payload.
 *
 * The signature is deliberately not re-verified here. This token is received
 * directly from Google's token endpoint over TLS in a server-to-server request,
 * which is the one case Google's own documentation says makes signature
 * validation unnecessary. It is never accepted from the browser, where that
 * assumption would not hold.
 */
export function decodeIdToken(idToken: string): GoogleIdentity | IdentityRejection {
  const parts = idToken.split(".");
  if (parts.length !== 3) return { reason: "Malformed identity token." };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { reason: "Unreadable identity token." };
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  if (!email) return { reason: "Google did not return an email address." };

  return {
    email,
    // Google sends this as a boolean or the string "true" depending on flow.
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: typeof payload.name === "string" ? payload.name : null,
    hostedDomain: typeof payload.hd === "string" ? payload.hd.toLowerCase() : null,
  };
}

export function isRejection(
  value: GoogleIdentity | IdentityRejection,
): value is IdentityRejection {
  return "reason" in value;
}

/**
 * Decide whether an identity may sign in, before consulting the database.
 *
 * Returns null when the identity clears these checks; a reason otherwise. The
 * caller still has to confirm the person exists in app_user -- passing here
 * only means they are not disqualified on their identity alone.
 */
export function checkIdentity(identity: GoogleIdentity): string | null {
  if (!identity.emailVerified) {
    return "That Google account has not verified its email address.";
  }
  if (!isApprovedDomain(identity.email)) {
    return "Sign in with your P5 company account.";
  }
  return null;
}

/** Build the URL that starts the Google flow. */
export function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("nonce", options.nonce);
  // Always show the chooser: these are shared machines, and silently reusing
  // whichever Google account happens to be signed in is how someone ends up
  // logged in as a colleague.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}
