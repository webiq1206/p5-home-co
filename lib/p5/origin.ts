/** Compare exact trusted origins, never an arbitrary forwarded-host header. */
export function isAllowedEstimatorOrigin(origin: string | null, requestUrl: string, domain: string): boolean {
  if (!origin) return true;
  const allowed = new Set([new URL(requestUrl).origin, `https://${domain}`, `https://www.${domain}`]);
  // Next's request URL can contain an internal host behind the preview proxy.
  // Only trust the platform's configured preview hosts, not all *.replit.dev.
  if (process.env.NODE_ENV !== "production") {
    for (const host of [process.env.REPLIT_DEV_DOMAIN, ...(process.env.REPLIT_DOMAINS || "").split(",")]) {
      if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host.trim())) allowed.add(`https://${host.trim()}`);
    }
  }
  return allowed.has(origin);
}