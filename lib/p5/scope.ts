/** Public scope vocabulary. No internal prices or financial policy belongs here. */
export const SCOPE_FIELDS = {
  service: { label: "Project type", kind: "choice", options: ["handyman", "re10", "cabinet-product", "cabinet-install", "kitchen", "bathroom", "whole-home", "addition", "adu", "new-construction", "change-order", "rush"] },
  location: { label: "City, ZIP code, county or general location", kind: "text" },
  address: { label: "Property address (optional)", kind: "text" },
  sqft: { label: "Project area in square feet", kind: "number" },
  garageIncluded: { label: "Garage in this project", kind: "choice", options: ["yes", "no"] },
  garageSqft: { label: "Garage area in square feet", kind: "number" },
  coveredOutdoorSqft: { label: "Covered outdoor area in square feet", kind: "number" },
  cabinetTallLf: { label: "Tall cabinet run in linear feet", kind: "number" },
  cabinetConstruction: { label: "Cabinet construction and hardware specification", kind: "text" },
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
  flooringSqft: { label: "Flooring area in square feet", kind: "number" },
  tileSqft: { label: "Tile area in square feet", kind: "number" },
  countertopSqft: { label: "Countertop area in square feet", kind: "number" },
  demolitionSqft: { label: "Demolition area in square feet", kind: "number" },
  fixtureCount: { label: "Number of fixtures", kind: "number" },
  laborHours: { label: "Estimated labor hours", kind: "number" },
  installation: { label: "Installation work and responsibilities", kind: "text" },
  taskList: { label: "Tasks and quantities", kind: "text" },
  otherDetails: { label: "Other scope details", kind: "text" },
} as const;
export type ScopeField = keyof typeof SCOPE_FIELDS;
export type ScopeAnswers = Partial<Record<ScopeField, string>>;
export interface ExtractedFact { field: ScopeField; value: string; confidence: number; source: string; evidence: string; basis?: "stated" | "calculated" | "visual" | "inferred" }
export interface ScopeConflict { field: ScopeField; values: string[]; explanation: string }
export interface ScopeExtraction { summary: string; facts: ExtractedFact[]; conflicts: ScopeConflict[]; missingInformation: string[]; reviewNotes: string[]; clarifications?: {field:ScopeField;question:string;reason:string}[] }
export interface ScopeUpload { id: string; name: string; type: string; size: number; sha256: string; status: "stored" | "failed" }
export interface ReviewedScope {
  text: string; answers: ScopeAnswers; extraction: ScopeExtraction | null; uploads: ScopeUpload[];
  uncertainFields?: ScopeField[];
  reviewedAt: string; corrections: { field: ScopeField; previous: string; value: string }[];
}
export const SCOPE_TEXT_LIMIT = 24000;
export const SCOPE_FILE_LIMIT = 250 * 1024 * 1024;
export const SCOPE_BATCH_LIMIT = 1024 * 1024 * 1024;
export const SCOPE_FILE_COUNT = 50;
export const SCOPE_CHUNK_SIZE = 4 * 1024 * 1024;
export const SCOPE_UPLOAD_HELP = "Up to 50 files, 250 MB each and 1 GB total. Large uploads resume after interruptions.";
export function validateAnswer(field: ScopeField, value: string): string | null {
  if (!Object.hasOwn(SCOPE_FIELDS,field)) return "Unknown field";
  if (typeof value !== "string" || value.length > 4000) return "Please shorten this answer to 4,000 characters.";
  if (!value.trim()) return null;
  const definition = SCOPE_FIELDS[field];
  if (definition.kind === "number") {
    if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(value.trim())) return "Enter a valid nonnegative number.";
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
  const unreadValues: string[] = [];
  const facts = r.facts.flatMap((item: unknown): ExtractedFact[] => {
    if (!item || typeof item !== "object") throw new Error("Invalid fact");
    const f = item as Record<string, unknown>;
    if (typeof f.field === "string" && Object.hasOwn(SCOPE_FIELDS,f.field) && SCOPE_FIELDS[f.field as ScopeField].kind === "number" && typeof f.value === "string" && validateAnswer(f.field as ScopeField,f.value)) {
      unreadValues.push(`Confirm ${SCOPE_FIELDS[f.field as ScopeField].label.toLowerCase()} if no other source supplies a readable value.`);
      return [];
    }
    if (typeof f.field !== "string" || !Object.hasOwn(SCOPE_FIELDS,f.field) || typeof f.value !== "string" || !f.value.trim() || validateAnswer(f.field as ScopeField, f.value) || typeof f.confidence !== "number" || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1 || typeof f.source !== "string" || !f.source.trim() || f.source.length > 500 || typeof f.evidence !== "string" || !f.evidence.trim() || f.evidence.length > 4000) throw new Error("Invalid extracted fact");
    if (f.basis !== undefined && !["stated", "calculated", "visual", "inferred"].includes(String(f.basis))) throw new Error("Invalid fact basis");
    // A model's confidence is not evidence that an assumption was supplied by the user.
    let confidence = f.confidence;
    if (f.basis === "inferred") confidence = Math.min(confidence, .2);
    if (f.basis === "visual") confidence = Math.min(confidence, SCOPE_FIELDS[f.field as ScopeField].kind === "number" ? 0 : .6);
    const value=SCOPE_FIELDS[f.field as ScopeField].kind === "number" ? String(Number(f.value.replaceAll(",", ""))) : f.value.trim();
    return [{ ...f, value, confidence } as unknown as ExtractedFact];
  });
  const conflicts = r.conflicts.map((item: unknown): ScopeConflict => {
    if (!item || typeof item !== "object") throw new Error("Invalid conflict");
    const c = item as Record<string, unknown>;
    if (typeof c.field !== "string" || !Object.hasOwn(SCOPE_FIELDS,c.field) || typeof c.explanation !== "string" || c.explanation.length > 4000) throw new Error("Invalid conflict");
    const field=c.field as ScopeField;
    const values=[...new Set(strings(c.values,10).filter(v=>v.trim()&&!validateAnswer(field,v)).map(v=>SCOPE_FIELDS[field].kind === "number" ? String(Number(v.replaceAll(",", ""))) : v.trim()))];
    return { field, values, explanation: c.explanation };
  });
  // Independent conflict detection: never let a model overwrite two different measurements.
  for (const field of Object.keys(SCOPE_FIELDS) as ScopeField[]) {
    const values = [...new Set(facts.filter(f => f.field === field && f.confidence >= .4).map(f => f.value.trim()))];
    if (values.length > 1 && SCOPE_FIELDS[field].kind !== "text" && !conflicts.some(c => c.field === field)) conflicts.push({ field, values, explanation: "The supplied information contains different values. Please confirm the intended scope." });
  }
  const clarifications=Array.isArray(r.clarifications)?r.clarifications.slice(0,20).map((q:any)=>{
    if(!q||!Object.hasOwn(SCOPE_FIELDS,q.field)||typeof q.question!=="string"||q.question.length>500||typeof q.reason!=="string"||q.reason.length>1000)throw new Error("Invalid clarification");
    return {field:q.field as ScopeField,question:q.question,reason:q.reason};
  }):[];
  return { summary: r.summary, facts, conflicts,clarifications, missingInformation: [...strings(r.missingInformation, 50),...unreadValues], reviewNotes: strings(r.reviewNotes, 50) };
}
const IMAGE_SOURCE = /\.(?:jpe?g|png|webp|gif|heic|heif)(?:\b|[),])/i;
const EXPLICIT_URGENCY = /\b(?:standard|normal timing|not urgent|priority|prioritized|emergency|urgent|rush|asap|same[- ]day|immediately)\b/i;
const INFERRED_URGENCY = /\b(?:assum(?:e|ed|ption)|unless|future planned|lead time|no (?:rush|urgency|priority|emergency)|not stated|not specified|without (?:rush|urgency|priority|emergency))\b/i;
const DERIVED_MEASUREMENT = /\b(?:calculat(?:e|ed|ion)|deriv(?:e|ed|ation)|multipl(?:y|ied|ication))\b|[×*=]|\b\d+(?:\.\d+)?\s*(?:ft|feet)\s+(?:by|x)\s+\d/i;
const NUMERIC_EVIDENCE:Partial<Record<ScopeField,RegExp>>={
  sqft:/\b(?:project|room|floor|home|addition|area)\b.{0,60}\b(?:square feet|square foot|sq\.?\s*ft|sf)\b|\b(?:square feet|square foot|sq\.?\s*ft|sf)\b.{0,60}\b(?:project|room|floor|home|addition|area)\b/i,
  length:/\b(?:length|long)\b/i,width:/\b(?:width|wide)\b/i,rooms:/\brooms?\b/i,bathrooms:/\bbathrooms?\b/i,stories:/\b(?:stories|story)\b/i,
  cabinetBaseLf:/\b(?:base|lower)\b.{0,40}\b(?:linear feet|linear foot|lf)\b|\b(?:linear feet|linear foot|lf)\b.{0,40}\b(?:base|lower)\b/i,
  cabinetUpperLf:/\b(?:upper|wall)\b.{0,40}\b(?:linear feet|linear foot|lf)\b|\b(?:linear feet|linear foot|lf)\b.{0,40}\b(?:upper|wall)\b/i,
};
/** Keep model interpretation available for review without turning it into a pricing input. */
export function protectPricingFacts(extraction: ScopeExtraction): ScopeExtraction {
  const facts: ExtractedFact[] = [];
  const reviewNotes = [...extraction.reviewNotes];
  let heldPhotoFacts = 0;
  let heldUrgency = false;
  let heldDerivedMeasurement = false;
  for (const fact of extraction.facts) {
    if (IMAGE_SOURCE.test(fact.source)) {
      heldPhotoFacts++;
      reviewNotes.push(`Unconfirmed photo observation - ${SCOPE_FIELDS[fact.field].label}: ${fact.value}. Confirm from written scope before pricing.`);
      continue;
    }
    if (fact.field === "urgency" && (!EXPLICIT_URGENCY.test(fact.evidence)||INFERRED_URGENCY.test(fact.evidence))) {
      heldUrgency = true;
      reviewNotes.push(`Unconfirmed timing assumption - ${fact.value}. The supplied scope did not explicitly state urgency, so this is not a pricing fact.`);
      continue;
    }
    const numericEvidence=NUMERIC_EVIDENCE[fact.field];
    if(numericEvidence&&(!numericEvidence.test(fact.evidence)||DERIVED_MEASUREMENT.test(fact.evidence))){
      heldDerivedMeasurement=true;
      reviewNotes.push(`Unconfirmed derived measurement - ${SCOPE_FIELDS[fact.field].label}: ${fact.value}. The source evidence does not explicitly label this measurement, so it is not a pricing fact.`);
      continue;
    }
    facts.push(fact);
  }
  const missingInformation = [...new Set(extraction.missingInformation)];
  if (heldPhotoFacts && !missingInformation.some(note => /confirm.*(?:photo|finish|material)/i.test(note))) {
    missingInformation.push("Confirm any material or finish shown only in photos if it affects the priced scope.");
  }
  if (heldUrgency && !missingInformation.some(note => /confirm.*(?:urgency|timing|schedule)/i.test(note))) {
    missingInformation.push("Confirm only if the project requires priority, emergency or other nonstandard scheduling.");
  }
  if(heldDerivedMeasurement&&!missingInformation.some(note=>/confirm.*(?:project area|measurement)/i.test(note))){
    missingInformation.push("Confirm the project area or other material measurement from the written scope before pricing.");
  }
  return {...extraction, facts, missingInformation, reviewNotes: [...new Set(reviewNotes)]};
}
export function mergeScopeFacts(current: ScopeAnswers, extraction: ScopeExtraction) {
  const answers = { ...current }; const conflicts = [...extraction.conflicts];
  const textFields=new Set<ScopeField>();
  for (const fact of extraction.facts) {
    if (fact.confidence < .85 || conflicts.some(c => c.field === fact.field)) continue;
    if(SCOPE_FIELDS[fact.field].kind==="text"){
      if(textFields.has(fact.field))continue;textFields.add(fact.field);
      const values=[...new Set([current[fact.field]?.trim(),...extraction.facts.filter(f=>f.field===fact.field&&f.confidence>=.85).map(f=>f.value.trim())].filter(Boolean))];
      const combined=[...new Set(values.flatMap(value=>value!.split("\n")).map(value=>value.trim()).filter(Boolean))].join("\n");
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
  merged.clarifications=parts.flatMap(p=>p.clarifications||[]).filter((q,i,a)=>a.findIndex(v=>v.field===q.field)===i);
  const seen=new Set<string>();
  for(const fact of parts.flatMap(p=>p.facts)){
    const key=JSON.stringify([fact.field,fact.value.trim(),fact.source,fact.evidence]);
    if(!seen.has(key)){seen.add(key);merged.facts.push(fact);}
  }
  for(const field of Object.keys(SCOPE_FIELDS) as ScopeField[]){
    const values=[...new Set(merged.facts.filter(f=>f.field===field&&f.confidence>=.4).map(f=>f.value.trim()))];
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
