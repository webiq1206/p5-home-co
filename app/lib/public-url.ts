/**
 * Work out the app's own public address.
 *
 * Behind a proxy -- Replit, and most hosts -- `request.url` is the address the
 * process is bound to, typically http://0.0.0.0:3000. That is not somewhere a
 * browser can be sent. Any absolute URL built from it is broken: an OAuth
 * redirect_uri Google rejects, or a post-sign-in redirect that dead-ends.
 *
 * The public host survives only in the forwarding headers, so they are read
 * first. When none of them yield a usable host this throws rather than
 * guessing, because a silently wrong absolute URL fails far away from its
 * cause and is miserable to diagnose.
 */

/** Addresses a server binds to, which no browser can be redirected to. */
export function isBindAddress(host: string): boolean {
  return /^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\])/.test(host);
}

/** Scheme and host the outside world reaches this app on, e.g. "https://p5homeco.com". */
export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    if (host && !isBindAddress(host)) return `${proto}://${host}`;
  }

  const host = request.headers.get("host");
  if (host && !isBindAddress(host)) {
    const proto = host.startsWith("localhost") ? "http" : "https";
    return `${proto}://${host}`;
  }

  const fromUrl = new URL(request.url);
  if (!isBindAddress(fromUrl.host)) return fromUrl.origin;

  throw new Error(
    "Cannot determine the app's public URL: every candidate host is a bind " +
      "address. Set GOOGLE_OAUTH_REDIRECT_URI, or ensure the proxy sends " +
      "x-forwarded-host.",
  );
}

/**
 * An absolute URL for a path on this app.
 *
 * Falls back to a relative path when the public origin cannot be determined,
 * because a relative redirect still lands the browser in the right place --
 * unlike an absolute one built from the bind address.
 */
export function appUrl(request: Request, path: string): string {
  try {
    return new URL(path, publicOrigin(request)).toString();
  } catch {
    return path;
  }
}
