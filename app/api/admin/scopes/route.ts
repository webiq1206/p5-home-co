/** Create a scope project. */

import { fail, ok, requireEmployee } from "../../../lib/scopes/http.ts";
import { createProject } from "../../../lib/scopes/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICES = new Set(["kitchen", "bathroom", "remodel", "whole-home", "addition", "adu", "new-construction", "handyman", "re10", "cabinet-product", "cabinet-install"]);

export async function POST(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    const service = SERVICES.has(body.service) ? body.service : "remodel";
    const id = await createProject(g.user.id, {
      title: (body.title ?? "").slice(0, 200),
      client_first_name: body.firstName?.slice(0, 100) || null,
      client_last_name: body.lastName?.slice(0, 100) || null,
      project_address: body.address?.slice(0, 300) || null,
      service,
    });
    return ok({ id });
  } catch (error) {
    return fail(error, 500);
  }
}
