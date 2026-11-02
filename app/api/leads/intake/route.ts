/**
 * Public lead intake endpoint: POST /api/leads/intake.
 *
 * The handling lives in handler.ts (contract: docs/lead-intake-contract.md)
 * so tests can run it without the Next.js server. This file only hands it the
 * real `after`, which runs mail once the response is finished.
 */

import { after } from "next/server";

import { handleIntake } from "./handler.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleIntake(request, after);
}
