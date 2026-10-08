import { z } from "zod";

export const PROJECT_REVIEW_KIND = "project_review_v1";
export const PROJECT_REVIEW_PATH = "/api/external/project-reviews";
export const PROJECT_REVIEW_BYTE_LIMIT = 2 * 1024 * 1024;
export const REVIEW_DOMAINS = {
  p5: "p5homeco.com", construction: "boiseconstruction.co", remodeling: "boiseremodeling.co",
  handyman: "boisehandyman.co", cabinet: "boisecabinet.co",
} as const;
const site = z.enum(["p5", "construction", "remodeling", "handyman", "cabinet"]);
const specialty = z.enum(["construction", "remodeling", "handyman", "cabinet"]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(8 * 1024 * 1024);
const contact = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.union([z.string().email().max(200), z.literal("")]),
  phone: z.string().max(40),
  preferredContact: z.enum(["email", "phone", "either"]),
}).strict().superRefine((c, ctx) => {
  const phone = c.phone.replace(/\D/g, "");
  if (c.phone && (phone.length < 10 || phone.length > 15)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Invalid phone" });
  if (!c.email && !c.phone) ctx.addIssue({ code: "custom", message: "Email or phone is required" });
  if (c.preferredContact === "email" && !c.email) ctx.addIssue({ code: "custom", message: "Email preference requires email" });
  if (c.preferredContact === "phone" && !c.phone) ctx.addIssue({ code: "custom", message: "Phone preference requires phone" });
});
export const projectReviewFileSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(4096), type: z.string().max(200),
  size: z.number().int().nonnegative().max(250 * 1024 * 1024), sha256: digest,
}).strict();
export const projectReviewSchema = z.object({
  schema: z.literal(1), requestType: z.literal(PROJECT_REVIEW_KIND),
  source: z.enum(["boiseconstruction.co", "boiseremodeling.co", "boisehandyman.co", "boisecabinet.co"]),
  externalLeadId: z.string().regex(/^(?:qa-)?p5-intake-[a-f0-9]{64}$/),
  snapshotDigest: digest,
  deliveryMode: z.enum(["live", "synthetic_qa"]),
  request: z.object({
    projectId: z.string().min(1).max(200), draftId: z.string().uuid(), revision: z.number().int().positive().max(2147483647),
    savedAt: z.string().datetime(), originSite: site, currentSite: specialty,
    contact,
    scope: z.object({ text, answers: z.record(z.string(), text), uploads: z.array(projectReviewFileSchema).max(500) }).strict(),
    details: z.object({
      desiredOutcome: z.string().max(4000), workContext: z.string().max(1000), budget: z.string().max(500),
      transcript: z.array(z.object({
        id: z.string().max(120), role: z.enum(["user", "assistant"]), text, at: z.number().finite(),
        kind: z.string().max(40).optional(), label: z.string().max(200).optional(), caption: z.string().max(500).optional(),
        files: z.array(z.string().max(4096)).max(50).optional(),
      }).strict()).max(500),
    }).strict(),
    routing: z.object({ primaryTeam: specialty, supportingServices: z.array(z.string().min(1).max(100)).max(30) }).strict(),
    unresolved: z.array(text).max(1000),
  }).strict(),
}).strict().superRefine((p, ctx) => {
  const r = p.request;
  if (REVIEW_DOMAINS[r.currentSite] !== p.source || r.routing.primaryTeam !== r.currentSite)
    ctx.addIssue({ code: "custom", message: "Source and receiving team must agree" });
  if (new Set(r.scope.uploads.map(f => f.id)).size !== r.scope.uploads.length)
    ctx.addIssue({ code: "custom", message: "Duplicate file identity" });
  if (Object.keys(r.scope.answers).some(k => k.length > 200) || Object.keys(r.scope.answers).length > 500)
    ctx.addIssue({ code: "custom", message: "Invalid answer fields" });
});
export type ProjectReview = z.infer<typeof projectReviewSchema>;

/** Fixed staff destinations, never caller-supplied URLs or bearer links. */
export function projectReviewLinks(p: ProjectReview) {
  const r = p.request;
  const base = `https://${REVIEW_DOMAINS[r.currentSite]}/api/admin/p5-intake`;
  const q = new URLSearchParams({ draftId: r.draftId, revision: String(r.revision) });
  return { record: `${base}?${q}`, files: r.scope.uploads.map(f => ({ ...f, url: `${base}/file?${q}&fileId=${encodeURIComponent(f.id)}` })) };
}

/** A source-owned review never enrolls in the CRM's legacy automatic outreach. */
export function isProjectReviewLead(lead: { intakeKind?: string | null }) {
  return lead.intakeKind === PROJECT_REVIEW_KIND;
}
