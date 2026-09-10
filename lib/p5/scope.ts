/** Public scope vocabulary. No internal prices or financial policy belongs here. */
export const SCOPE_FIELDS = {
  service: { label: "Project type", kind: "choice", options: ["handyman", "re10", "cabinet-product", "cabinet-install", "kitchen", "bathroom", "whole-home", "addition", "adu", "new-construction", "change-order", "rush"] },
  location: { label: "City, ZIP code, county or general location", kind: "text" },
  address: { label: "Property address (optional)", kind: "text" },
  sqft: { label: "Project area in square feet", kind: "number" },
  length: { label: "Length in feet", kind: "number" },
  width: { label: "Width in feet", kind: "number" },
  rooms: { label: "Number of rooms", kind: "number" },
  bathrooms: { label: "Number of bathrooms", kind: "number" },
  stories: { label: "Number of stories", kind: "number" },
  cabinetBaseLf: { label: "Base cabinet run in linear feet", kind: "number" },
  cabinetUpperLf: { label: "Upper cabinet run in linear feet", kind: "number" },
  cabinetRoom: { label: "Cabinet room", kind: "choice", options: ["kitchen", "bathroom", "laundry", "mudroom", "home-office", "entertainment", "built-ins", "pantry"] },
  finish: { label: "Finish level", kind: "choice", options: ["refresh", "mid-range", "high-end", "luxury"] },
  materials: { label: "Materials and finishes", kind: "text" },
  fixtures: { label: "Fixtures", kind: "text" },
  appliances: { label: "Appliances and responsibilities", kind: "text" },
  demolition: { label: "Demolition", kind: "text" },
  structural: { label: "Structural work", kind: "text" },
  mechanical: { label: "Heating, cooling and ventilation", kind: "text" },
  electrical: { label: "Electrical work", kind: "text" },
  plumbing: { label: "Plumbing work", kind: "text" },
  site: { label: "Site conditions, soil and slope", kind: "text" },
  access: { label: "Access and occupied-home constraints", kind: "text" },
  allowances: { label: "Allowances and selection deadlines", kind: "text" },
  exclusions: { label: "Excluded work", kind: "text" },
  alternates: { label: "Alternates", kind: "text" },
  ownerSupplied: { label: "Owner-supplied items and responsibilities", kind: "text" },
  permits: { label: "Permits and inspections", kind: "text" },
  engineering: { label: "Engineering and design", kind: "text" },
  utilities: { label: "Utilities and connections", kind: "text" },
  schedule: { label: "Requested schedule", kind: "text" },
  urgency: { label: "Timing", kind: "choice", options: ["standard", "priority", "emergency"] },
  complexity: { label: "Project complexity", kind: "choice", options: ["standard", "complex"] },
  phasing: { label: "Project phasing", kind: "text" },
  taskList: { label: "Tasks and quantities", kind: "text" },
  otherDetails: { label: "Other scope details", kind: "text" },
} as const;
export type ScopeField = keyof typeof SCOPE_FIELDS;
export type ScopeAnswers = Partial<Record<ScopeField, string>>;
export interface ExtractedFact { field: ScopeField; value: string; confidence: number; source: string; evidence: string }
export interface ScopeConflict { field: ScopeField; values: string[]; explanation: string }
export interface ScopeExtraction { summary: string; facts: ExtractedFact[]; conflicts: ScopeConflict[]; missingInformation: string[]; reviewNotes: string[] }
export interface ScopeUpload { id: string; name: string; type: string; size: number; sha256: string; status: "stored" | "failed" }
export interface ReviewedScope {
  text: string; answers: ScopeAnswers; extraction: ScopeExtraction | null; uploads: ScopeUpload[];
  reviewedAt: string; corrections: { field: ScopeField; previous: string; value: string }[];
}
export const SCOPE_TEXT_LIMIT = 24000;
export const SCOPE_FILE_LIMIT = 10 * 1024 * 1024;
export const SCOPE_BATCH_LIMIT = 22 * 1024 * 1024;
export function validateAnswer(field: ScopeField, value: string): string | null {
  if (!Object.hasOwn(SCOPE_FIELDS,field)) return "Unknown field";
  if (typeof value !== "string" || value.length > 4000) return "Please shorten this answer to 4,000 characters.";
  if (!value.trim()) return null;
  const definition = SCOPE_FIELDS[field];
  if (definition.kind === "number") {
    const number = Number(value.replaceAll(",", ""));
    if (!Number.isFinite(number) || number < 0 || number > 1000000) return "Enter a valid nonnegative number.";
    if (["rooms", "bathrooms", "stories"].includes(field) && !Number.isInteger(number)) return "Enter a whole number.";
  }
  if (definition.kind === "choice" && !(definition.options as readonly string[]).includes(value)) return "Choose one of the listed options.";
  return null;
}
export function validateExtraction(raw: unknown): ScopeExtraction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid scope analysis");
  const r = raw as Record<string, unknown>;
  const strings = (value: unknown, max: number) => { if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== "string" || x.length > 4000)) throw new Error("Invalid analysis notes");return value as string[]; };
  if (typeof r.summary !== "string" || r.summary.length > 8000 || !Array.isArray(r.facts) || r.facts.length > 150 || !Array.isArray(r.conflicts) || r.conflicts.length > 50) throw new Error("Invalid scope analysis");
  const facts = r.facts.map((item: unknown): ExtractedFact => {
    if (!item || typeof item !== "object") throw new Error("Invalid fact");
    const f = item as Record<string, unknown>;
    if (typeof f.field !== "string" || !Object.hasOwn(SCOPE_FIELDS,f.field) || typeof f.value !== "string" || !f.value.trim() || validateAnswer(f.field as ScopeField, f.value) || typeof f.confidence !== "number" || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1 || typeof f.source !== "string" || !f.source.trim() || f.source.length > 500 || typeof f.evidence !== "string" || !f.evidence.trim() || f.evidence.length > 4000) throw new Error("Invalid extracted fact");
    return f as unknown as ExtractedFact;
  });
  const conflicts = r.conflicts.map((item: unknown): ScopeConflict => {
    if (!item || typeof item !== "object") throw new Error("Invalid conflict");
    const c = item as Record<string, unknown>;
    if (typeof c.field !== "string" || !Object.hasOwn(SCOPE_FIELDS,c.field) || typeof c.explanation !== "string" || c.explanation.length > 4000) throw new Error("Invalid conflict");
    return { field: c.field as ScopeField, values: strings(c.values, 10), explanation: c.explanation };
  });
  // Independent conflict detection: never let a model overwrite two different measurements.
  for (const field of Object.keys(SCOPE_FIELDS) as ScopeField[]) {
    const values = [...new Set(facts.filter(f => f.field === field).map(f => f.value.trim()))];
    if (values.length > 1 && SCOPE_FIELDS[field].kind !== "text" && !conflicts.some(c => c.field === field)) conflicts.push({ field, values, explanation: "The supplied information contains different values. Please confirm the intended scope." });
  }
  return { summary: r.summary, facts, conflicts, missingInformation: strings(r.missingInformation, 50), reviewNotes: strings(r.reviewNotes, 50) };
}
export function mergeScopeFacts(current: ScopeAnswers, extraction: ScopeExtraction) {
  const answers = { ...current }; const conflicts = [...extraction.conflicts];
  const textFields=new Set<ScopeField>();
  for (const fact of extraction.facts) {
    if (fact.confidence < .85 || conflicts.some(c => c.field === fact.field)) continue;
    if(SCOPE_FIELDS[fact.field].kind==="text"){
      if(textFields.has(fact.field))continue;textFields.add(fact.field);
      const values=[...new Set([current[fact.field]?.trim(),...extraction.facts.filter(f=>f.field===fact.field&&f.confidence>=.85).map(f=>f.value.trim())].filter(Boolean))];
      const combined=values.join("\n");
      if(combined.length<=4000)answers[fact.field]=combined;
      else conflicts.push({field:fact.field,values:[current[fact.field]||""].filter(Boolean),explanation:"This trade scope exceeds one answer. Review the full source details and enter a concise summary without omitting priced work."});
      continue;
    }
    const existing = answers[fact.field]?.trim();
    if (existing && existing !== fact.value.trim()) {
      conflicts.push({ field: fact.field, values: [existing, fact.value], explanation: "Your previous answer differs from the submitted scope. Choose which is correct." });
      continue;
    }
    answers[fact.field] = fact.value;
  }
  return { answers, conflicts };
}
/** Merge page reads without losing distinct measurements or additive trade scope. */
export function combineScopeExtractions(parts:ScopeExtraction[]):ScopeExtraction {
  const merged:ScopeExtraction={summary:[...new Set(parts.map(p=>p.summary).filter(Boolean))].join("\n"),facts:[],conflicts:parts.flatMap(p=>p.conflicts),missingInformation:[...new Set(parts.flatMap(p=>p.missingInformation))],reviewNotes:[...new Set(parts.flatMap(p=>p.reviewNotes))]};
  const seen=new Set<string>();
  for(const fact of parts.flatMap(p=>p.facts)){
    const key=JSON.stringify([fact.field,fact.value.trim(),fact.source,fact.evidence]);
    if(!seen.has(key)){seen.add(key);merged.facts.push(fact);}
  }
  for(const field of Object.keys(SCOPE_FIELDS) as ScopeField[]){
    const values=[...new Set(merged.facts.filter(f=>f.field===field).map(f=>f.value.trim()))];
    if(values.length>1&&SCOPE_FIELDS[field].kind!=="text"&&!merged.conflicts.some(c=>c.field===field))merged.conflicts.push({field,values,explanation:"Different document pages state different values. Confirm the intended project information."});
  }
  // Missing questions from one page may be answered on another.
  merged.missingInformation=merged.missingInformation.filter(note=>!merged.facts.some(f=>f.confidence>=.85&&note.trim().toLowerCase()===SCOPE_FIELDS[f.field].label.toLowerCase()));
  return merged;
}
export function requiredScopeQuestions(answers: ScopeAnswers): ScopeField[] {
  if (!answers.service) return ["service"];
  const questions: ScopeField[] = [];
  if (["handyman", "re10", "change-order", "rush"].includes(answers.service)) questions.push("taskList");
  else if (answers.service.startsWith("cabinet-")) {
    questions.push("cabinetRoom", "cabinetBaseLf");
    if (answers.cabinetRoom && !["bathroom", "pantry"].includes(answers.cabinetRoom)) questions.push("cabinetUpperLf");
  } else questions.push("sqft");
  // Location and exact address are deliberately never required.
  return questions.filter(k => !answers[k]?.trim());
}
export function scopeText(record: ReviewedScope): string {
  return [record.text, ...Object.entries(record.answers).filter(([,v]) => v?.trim()).map(([key,value]) => `${SCOPE_FIELDS[key as ScopeField].label}: ${value}`)].filter(Boolean).join("\n");
}
