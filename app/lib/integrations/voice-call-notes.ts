/** Only authenticated Google Voice notification mail may reach this parser. */
export const GEMINI_VOICE_NOTES_SENDER = "gemini-call-notes-noreply@google.com";

export type VoiceNotes = {
  callerPhone: string;
  summary: string;
  automatic: boolean;
  usable: boolean;
  scopeDraft: string | null;
};

function numberFromSubject(subject: string): string | null {
  const match = subject.match(/^Notes from call with\s+\(?([2-9]\d{2})\)?[\s.-]*([2-9]\d{2})[\s.-]*(\d{4})\s*$/i);
  return match ? `+1${match[1]}${match[2]}${match[3]}` : null;
}

function headerValue(headers: { key: string; line: string }[], name: string) {
  const entry = headers.find(h => h.key.toLowerCase() === name);
  return entry?.line.replace(/^[^:]+:\s*/, "").trim() || "";
}

/**
 * Google Voice sends an email after Gemini processes a call. The email is not
 * a transcript or proof that the caller authorized construction work.
 * Do not convert a short or incomplete notice into a fabricated scope.
 */
export function parseVoiceNotesMessage(mail: {
  subject: string; text: string; from: { email: string }[];
  headers: { key: string; line: string }[];
}): VoiceNotes | null {
  if (mail.from.length !== 1 || mail.from[0].email.toLowerCase() !== GEMINI_VOICE_NOTES_SENDER) return null;
  const callerPhone = numberFromSubject(mail.subject);
  if (!callerPhone || callerPhone === "+12084771169") return null;
  const parts = mail.text.split(/\r?\n/);
  const begin = parts.findIndex(line => line.trim() === "Notes");
  if (begin < 0) return null;
  const end = parts.findIndex((line, index) => index > begin && /^Was this email useful\?/i.test(line.trim()));
  const candidate = parts.slice(begin + 1, end > begin ? end : undefined).join("\n").trim();
  if (!candidate || candidate.length > 20_000) return null;
  const tooShort = /^(?:Call was too short for notes\.|No (?:notes|summary) (?:were|was) (?:created|generated)\.)/i.test(candidate);
  const usable = !tooShort && candidate.length >= 30;
  const origin = headerValue(mail.headers, "x-notifications");
  const automatic = /-automatic_call_recording\b/i.test(origin);
  return { callerPhone, summary: candidate, automatic, usable,
    scopeDraft: usable ? preliminaryScopeDraft(candidate) : null };
}

/**
 * Conservative deterministic intake draft. It preserves the source's own
 * wording and never invents sizes, prices, permissions, materials or dates.
 * Any draft requires human review before it becomes a client-facing SOW.
 */
export function preliminaryScopeDraft(summary: string): string | null {
  if (summary.length < 80) return null;
  if (!/\b(remodel|renovat|construct|add(?:ition)?|build|install|replace|repair|demolish|frame|paint|floor|cabinet|tile|plumb|electrical|roof|foundation|drywall|countertop|bathroom|kitchen)\w*/i.test(summary)) return null;
  if (!/\b(want(?:s|ed)?|need(?:s|ed)?|request(?:s|ed)?|plan(?:s|ned)?|propos(?:e|ed)|install|replace|repair|remodel|renovate|build|construct|finish|remove|update|convert)\w*/i.test(summary)) return null;
  // Include only the source's own construction-related clauses. Never rewrite
  // a speculative customer statement into an authorized construction task.
  const candidates=summary.replace(/\r/g,"").split(/(?<=[.!?])\s+|\n+/).map(part=>part.trim())
    .filter(part=>part.length>=18 && /\b(remodel|renovat|construct|addition|building|install|replac|repair|demoli|fram|paint|floor|cabinet|tile|plumb|electric|roof|foundation|drywall|countertop|bathroom|kitchen)\w*/i.test(part))
    .filter(part=>/\b(want|need|request|plan|propos|install|replac|repair|remodel|renovat|build|construct|finish|remove|update|convert|discuss)\w*/i.test(part))
    .slice(0,30);
  if(!candidates.length)return null;
  return [
    "PRELIMINARY DRAFT SCOPE OF WORK - INTERNAL REVIEW ONLY",
    "Source: Google Voice auto-generated AI call notes. Not a signed scope, estimate, bid or authorization.",
    "",
    "Potential work components discussed (not approved or priced):",
    ...candidates.map(item=>"- "+item),
    "",
    "Full customer discussion for context (verbatim Gemini summary):",
    summary,
    "",
    "Review required: Verify the actual requested work versus options/negations, customer identity, property/project association, quantities, materials, selections, site conditions and exclusions. Price only after review."
  ].join("\n");
}
