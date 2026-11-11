/** Add or remove scopes-only accounts. Administrators only. */

import { canManagePeople, fail, ok, requireEmployee } from "../../../lib/scopes/http.ts";
import { addPerson, listPeople, setPersonActive } from "../../../lib/scopes/people.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  if (!canManagePeople(g.user)) return fail(new Error("Only an administrator can manage access."), 403);
  return ok({ people: await listPeople() });
}

export async function POST(request: Request) {
  const g = await requireEmployee();
  if ("response" in g) return g.response;
  if (!canManagePeople(g.user)) return fail(new Error("Only an administrator can manage access."), 403);
  try {
    const body = (await request.json()) as { action?: string; email?: string; name?: string; id?: number; active?: boolean };
    if (body.action === "add") await addPerson(String(body.email ?? ""), String(body.name ?? ""), g.user.id);
    else if (body.action === "set-active" && Number.isInteger(body.id)) await setPersonActive(Number(body.id), body.active === true, g.user.id);
    else throw new Error("Unknown action.");
    return ok({ people: await listPeople() });
  } catch (error) {
    return fail(error);
  }
}
