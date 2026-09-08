import { NextResponse } from "next/server";
import { SESSION_ID_RE, recordCallbackRequest } from "../../../lib/leads/estimatorSessions.ts";

export const dynamic = "force-dynamic";

const buckets = new Map<string, { count: number; resetAt: number }>();
function allow(ip: string, limit = 6, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) { buckets.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
  b.count += 1;
  return b.count <= limit;
}

/** "Call me back instead" from the quote form's leave prompt. Retry-safe. */
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!allow(ip)) return NextResponse.json({ ok: false, error: "rate_limited", message: "Too many requests. Please call (208) 477-1169." }, { status: 429 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !SESSION_ID_RE.test(r.sessionId) || typeof r.flow !== "string" || typeof r.phone !== "string" || (typeof r.website === "string" && r.website.length > 0)) {
    return NextResponse.json({ ok: false, error: "invalid_payload", message: "Please enter a valid phone number." }, { status: 400 });
  }
  const digits = r.phone.replace(/\D/g, "");
  if (digits.length < 10) return NextResponse.json({ ok: false, error: "invalid_phone", message: "Please enter a 10-digit phone number." }, { status: 400 });
  const result = await recordCallbackRequest({
    sessionId: r.sessionId,
    flow: r.flow.slice(0, 40),
    phone: digits,
    name: typeof r.name === "string" ? r.name.slice(0, 80) : undefined,
    note: typeof r.note === "string" ? r.note.slice(0, 500) : undefined,
    pagePath: typeof r.pagePath === "string" ? r.pagePath.slice(0, 400) : undefined,
    device: typeof r.device === "string" ? r.device.slice(0, 10) : undefined,
  });
  if (!result.stored) return NextResponse.json({ ok: false, error: result.error ?? "persistence_failed", message: "We could not save your request. Please call (208) 477-1169." }, { status: 503 });
  return NextResponse.json({ ok: true, notified: result.notified });
}
