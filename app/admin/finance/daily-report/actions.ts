"use server";

/**
 * Actions for the daily report page. "Generate and send now" runs exactly
 * the same step the scheduler runs, so what you test is what ships each
 * morning.
 */

import { revalidatePath } from "next/cache";

import { getSessionUser } from "../../../lib/auth.ts";
import { runDailyReportStep } from "../../../lib/finance/jobs.ts";

export async function generateAndSendNow(): Promise<void> {
  const user = await getSessionUser();
  if (!user || (user.role !== "administrator" && user.role !== "manager")) {
    throw new Error("Finance access requires an administrator or manager session.");
  }
  await runDailyReportStep(new Date());
  revalidatePath("/admin/finance/daily-report");
}
