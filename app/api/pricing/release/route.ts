/**
 * The approved pricing release, for the family sites' servers.
 *
 * Server to server only: the caller presents P5_PRICING_RELEASE_TOKEN. The
 * snapshot is the internal catalog and bid rules, so it is never public and is
 * never cached by an intermediary. Each site verifies the digest it receives.
 */
import { secretsMatch } from "../../../lib/auth.ts";
import { releaseVersion, resolveActiveRelease } from "../../../lib/pricing-release/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function GET(request: Request) {
  const expected = process.env.P5_PRICING_RELEASE_TOKEN?.trim();
  if (!expected || expected.length < 24) return Response.json({ error: "Pricing release sharing is not configured." }, { status: 503, headers });
  const provided = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
  if (!secretsMatch(provided, expected)) return Response.json({ error: "Not authorized." }, { status: 401, headers });
  const version = new URL(request.url).searchParams.get("version") ?? undefined;
  try {
    const release = version ? await releaseVersion(version) : await resolveActiveRelease();
    // Nothing published: every site prices from the catalog compiled into its build.
    if (release.source === "baseline") return Response.json({ baseline: true, version: release.version, digest: release.digest }, { headers });
    return Response.json({ version: release.version, digest: release.digest, generation: release.generation ?? null, snapshot: release.snapshot }, { headers });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return Response.json({ error: "That pricing version is not available." }, { status: status === 400 || status === 404 ? status : 503, headers });
  }
}
