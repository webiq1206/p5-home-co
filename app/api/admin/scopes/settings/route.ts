/**
 * Pricing setup: the $125/hour labor treatment, loaded labor cost, production
 * rates, taxable items and item mapping, plus a live check of what the
 * connected QuickBooks company contains. Reading is open to employees;
 * changing requires the manage_settings permission.
 */

import { reprice } from "../../../../lib/scopes/engine.ts";
import { canManagePricing, fail, ok, requireEmployee } from "../../../../lib/scopes/http.ts";
import { P5_ITEMS, setupCheck } from "../../../../lib/scopes/qbo.ts";
import { loadScopeSettings, saveScopeSettings } from "../../../../lib/scopes/store.ts";
import { costBookEntry } from "../../../../lib/scopes/costbook.ts";
import { query } from "../../../../lib/db.ts";
import type { ItemKey, LaborTreatment, ScopeSettings } from "../../../../lib/scopes/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  const settings = await loadScopeSettings();
  const check = new URL(request.url).searchParams.get("check") === "1" ? await setupCheck(settings).catch((e: Error) => ({ error: e.message })) : null;
  return ok({ settings, check, canManage: canManagePricing(g.user) });
}

const TREATMENTS: LaborTreatment[] = ["billed-rate", "direct-cost", "unconfirmed"];

export async function POST(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  if (!canManagePricing(g.user)) return fail(new Error("Only an administrator can change pricing setup."), 403);
  try {
    const body = (await request.json()) as Partial<ScopeSettings>;
    const current = await loadScopeSettings();
    const next: ScopeSettings = { ...current };
    if (typeof body.laborRate === "number" && body.laborRate > 0 && body.laborRate < 1000) next.laborRate = body.laborRate;
    if (body.laborTreatment && TREATMENTS.includes(body.laborTreatment)) next.laborTreatment = body.laborTreatment;
    if (body.laborLoadedCost === null || (typeof body.laborLoadedCost === "number" && body.laborLoadedCost >= 0)) next.laborLoadedCost = body.laborLoadedCost ?? null;
    if (typeof body.priceMaxAgeDays === "number" && body.priceMaxAgeDays >= 30) next.priceMaxAgeDays = Math.round(body.priceMaxAgeDays);
    if (Array.isArray(body.taxableItems)) next.taxableItems = body.taxableItems.filter((i): i is ItemKey => P5_ITEMS.includes(i as ItemKey));
    if (body.itemOverrides && typeof body.itemOverrides === "object") {
      next.itemOverrides = Object.fromEntries(
        Object.entries(body.itemOverrides).filter(([k, v]) => P5_ITEMS.includes(k as ItemKey) && typeof v === "string" && /^\d+$/.test(v)),
      );
    }
    if (body.productionRates && typeof body.productionRates === "object") {
      next.productionRates = Object.fromEntries(
        Object.entries(body.productionRates)
          .filter(([code, r]) => costBookEntry(code) && r && typeof r.hoursPerUnit === "number" && r.hoursPerUnit > 0)
          .map(([code, r]) => [code, { hoursPerUnit: r.hoursPerUnit, note: r.note?.slice(0, 200) }]),
      );
    }
    if (next.laborTreatment !== current.laborTreatment) {
      next.confirmedBy = g.user.fullName;
      next.confirmedAt = new Date().toISOString();
    }
    await saveScopeSettings(next, g.user.id);
    // Re-price open projects so their status reflects the new setup.
    const open = await query<{ id: string }>("SELECT id FROM scope_project WHERE archived_at IS NULL AND current_version_id IS NOT NULL");
    for (const p of open) await reprice(Number(p.id), g.user.id, "Pricing setup changed").catch(() => undefined);
    return ok({ settings: next });
  } catch (error) {
    return fail(error);
  }
}
