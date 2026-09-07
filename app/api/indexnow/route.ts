import { NextResponse } from "next/server";
import { secretsMatch } from "../../lib/auth.ts";
import { isDatabaseConfigured, query } from "../../lib/db.ts";
import { submitIndexNow, validateIndexNowUrls } from "../../lib/indexnow.ts";

export const dynamic = "force-dynamic";

type Change = { url: string; changeToken: string; action?: "upsert" | "delete" };

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function POST(request: Request) {
  const expected = process.env.WATCHDOG_SECRET;
  if (!expected || !secretsMatch(bearer(request), expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }

  const body = (await request.json()) as { changes?: Change[] };
  const changes = body.changes ?? [];
  if (changes.length === 0 || changes.some((item) => !item.changeToken)) {
    return NextResponse.json({ ok: false, error: "Each change needs a URL and change token." }, { status: 400 });
  }

  let currentUrls: string[];
  try {
    currentUrls = validateIndexNowUrls(
      changes.filter((item) => item.action !== "delete").map((item) => item.url),
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
  }

  await query(`
    CREATE TABLE IF NOT EXISTS indexnow_submissions (
      url text PRIMARY KEY,
      change_token text NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const changed: Change[] = [];
  for (const item of changes) {
    const absoluteUrl = new URL(item.url, "https://p5homeco.com").href;
    const rows = await query<{ change_token: string }>(
      "SELECT change_token FROM indexnow_submissions WHERE url = $1",
      [absoluteUrl],
    );
    if (item.action === "delete" && !rows[0]) {
      return NextResponse.json(
        { ok: false, error: `Deleted URL was not previously recorded as public: ${absoluteUrl}` },
        { status: 400 },
      );
    }
    if (rows[0]?.change_token !== item.changeToken) changed.push({ ...item, url: absoluteUrl });
  }

  if (changed.length === 0) {
    return NextResponse.json({ ok: true, submitted: 0, unchanged: changes.length });
  }

  const indexNowStatus = await submitIndexNow(
    changed.map((item) => item.url),
    { allowPreviouslyPublic: changed.some((item) => item.action === "delete") },
  );
  for (const item of changed) {
    await query(
      `INSERT INTO indexnow_submissions (url, change_token, submitted_at)
       VALUES ($1, $2, now())
       ON CONFLICT (url) DO UPDATE
       SET change_token = EXCLUDED.change_token, submitted_at = EXCLUDED.submitted_at`,
      [item.url, item.changeToken],
    );
  }

  return NextResponse.json({
    ok: true,
    submitted: changed.length,
    unchanged: changes.length - changed.length,
    activePublicUrls: currentUrls.length,
    indexNowStatus,
  });
}