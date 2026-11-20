/**
 * Send the short-form lead confirmation. A missing or unusable address is a
 * no-op: the form still accepts a phone alone. A send failure is logged and
 * never thrown, so it cannot change the visitor's response.
 */

import { BRAND_CONFIGS } from "../estimator/brands.ts";
import { activeTransport } from "../notifications/transport.ts";
import { normalizeEmail } from "./normalize.ts";
import { requestConfirmation, type ScheduleIntent } from "./scheduleEmail.ts";

export function accentForBrandName(name: string): string {
  return Object.values(BRAND_CONFIGS).find((brand) => brand.name === name)?.accent ?? "#a58c72";
}

export async function sendRequestConfirmation(input: {
  email: string | null;
  firstName: string | null;
  brandName: string;
  intent: ScheduleIntent;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  try {
    const message = requestConfirmation({
      firstName: input.firstName,
      brandName: input.brandName,
      intent: input.intent,
      accent: accentForBrandName(input.brandName),
    });
    const sent = await activeTransport().send(email, message);
    if (!sent.ok) console.error("[lead-confirmation] not sent:", sent.error);
  } catch (error) {
    console.error("[lead-confirmation] failed:", (error as Error).message);
  }
}
