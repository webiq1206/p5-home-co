// Verbatim externalLeadSchema and validateRequest from the authenticated
// BRC-Lead-Dashboard validation.ts snapshot at receiver commit
// 571c6f6d8009994325bf59bb322a74a65697eab5.
import {z} from "zod";

export const externalLeadSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(255),
  email: z.string().email("Valid email is required").max(255),
  phone: z.string().max(50).optional(),
  secondaryPhone: z.string().max(50).optional(),
  propertyAddress: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  preferredContactMethod: z.string().max(20).optional(),
  smsOptIn: z.boolean().optional(),
  projectTypes: z.array(z.string()).optional(),
  budgetRange: z.string().max(50).optional(),
  timeline: z.string().max(100).optional(),
  projectScope: z.string().max(2000).optional(),
  siteStatus: z.string().max(50).optional(),
  livingInHome: z.string().max(10).optional(),
  usableAreas: z.string().max(1000).optional(),
  additionAttached: z.string().max(10).optional(),
  designAssistanceNeeded: z.string().max(10).optional(),
  plansStatus: z.string().max(50).optional(),
  architectSelected: z.string().max(10).optional(),
  targetHomeSizeRange: z.string().max(50).optional(),
  projectGoals: z.string().max(2000).optional(),
  plansInspiration: z.string().max(50).optional(),
  desiredStartRange: z.string().max(50).optional(),
  deadlineNotes: z.string().max(1000).optional(),
  decisionMakerStatus: z.string().max(50).optional(),
  priorityFactors: z.array(z.string()).optional(),
  premiumComfort: z.string().max(50).optional(),
  finalNotes: z.string().max(2000).optional(),
  estimate: z.record(z.any()).optional(),
  property: z.record(z.any()).optional(),
  estimateSummary: z.string().max(20000).optional(),
  estimateLow: z.number().optional(),
  estimateHigh: z.number().optional(),
  estimateRange: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
});

export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string; details: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errorMessages = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  return { success: false, error: errorMessages, details: result.error };
}