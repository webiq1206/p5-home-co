import {mergeInstructions,validateInstructions,type ScopeInstructions} from './instructions.ts';
import {readPageRecords,readTakeoffs,reconcileTakeoffs,combineCoverage,blockingReviewNote} from './documentLedger.ts';
import type {RetainedClarificationProvenance,RetainedLaborCoverage} from './retainedClarification.ts';
import {aggregateLaborFacts} from './laborFacts.ts';
import {verifiedCabinetWidth} from './cabinetMeasurements.ts';
/** Public scope vocabulary. No internal prices or financial policy belongs here. */
export const SCOPE_FIELDS = {
  estimatingInstructions: {label: "Custom estimating instructions", kind: "text"},
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
  trimLf: { label: "Trim or baseboard length in feet", kind: "number" },
  projectMonths: { label: "Estimated construction duration in months", kind: "number" },
  installation: { label: "Installation work and responsibilities", kind: "text" },
  taskList: { label: "Tasks and quantities", kind: "text" },
  otherDetails: { label: "Other scope details", kind: "text" },
} as const;
export type ScopeField = keyof typeof SCOPE_FIELDS;
export type ScopeAnswers = Partial<Record<ScopeField, string>>;
export interface ExtractedFact { field: ScopeField; value: string; confidence: number; source: string; evidence: string; basis?: "stated" | "calculated" | "visual" | "inferred" }
export interface ScopeConflict { field: ScopeField; values: string[]; explanation: string }
export interface ScopeExtraction {
  summary: string;
  sourceText?:string;
  facts: ExtractedFact[];
  conflicts: ScopeConflict[];
  missingInformation: string[];
  reviewNotes: string[];
  clarifications?: {field:ScopeField;question:string;reason:string}[];
  instructions?:ScopeInstructions;
  documentCoverage?:import('./documentLedger.ts').DocumentCoverage;
  takeoffs?:import('./documentLedger.ts').Takeoff[];
  /** Source-only alternatives retained for archival review, never active pricing. */
  clarificationProvenance?:RetainedClarificationProvenance;
  /** Backward-compatible alias carrying the same retained metadata. */
  sourceHistory?:RetainedClarificationProvenance;
  /** Component hours are billable; their total is a non-additive audit summary. */
  laborCoverage?:RetainedLaborCoverage;
}
export interface ScopeUpload { id: string; name: string; type: string; size: number; sha256: string; status: "stored" | "failed" }
export interface ReviewedScope {
  text: string; answers: ScopeAnswers; extraction: ScopeExtraction | null; uploads: ScopeUpload[];
  uncertainFields?: ScopeField[];
  reviewedAt: string; corrections: { field: ScopeField; previous: string; value: string }[];
}
// Transport safety, not a textarea or instruction-count limit. Larger sources
// use the resumable document upload and are processed in full sections.
export const SCOPE_TEXT_LIMIT = 8 * 1024 * 1024;
export const SCOPE_FILE_LIMIT = 250 * 1024 * 1024;
export const SCOPE_BATCH_LIMIT = 1024 * 1024 * 1024;
export const SCOPE_FILE_COUNT = 50;
export const SCOPE_CHUNK_SIZE = 4 * 1024 * 1024;
/** The public page limit is intentionally shared by upload admission, legacy
 * segmentation and the hosted reader. Keep this a hard safety limit: larger
 * plans must be split by the customer rather than silently sampled. The saved
 * extraction parser keeps its own independent defensive ceiling. */
export const SCOPE_MAX_PAGES = 250;
/** Historical per-brand names for the same limit. They are aliases so every
 * caller written against any brand's copy compiles and can never drift. */
export const SCOPE_PAGE_LIMIT = SCOPE_MAX_PAGES;
export const SCOPE_PDF_PAGE_LIMIT = SCOPE_MAX_PAGES;
export const SCOPE_PLAN_PAGE_LIMIT = SCOPE_MAX_PAGES;
export const SCOPE_PLAN_PAGE_TARGET = SCOPE_MAX_PAGES;
export const SCOPE_UPLOAD_HELP = "Up to 50 files, 250 MiB each and 1 GiB total; up to 250 pages per PDF. Large uploads resume after interruptions.";
/** Map a model's wording for a choice field onto one of its options, or
 * null when no option is a clear match. Providers answer "Standard finishes"
 * or "premium" for a field whose options are refresh / mid-range / high-end /
 * luxury; rejecting the whole extraction for that wording lost every other
 * verified fact. */
export function coerceChoice(field: ScopeField, value: string): string | null {
  const definition = SCOPE_FIELDS[field];
  if (definition.kind !== "choice") return null;
  const options = definition.options as readonly string[];
  const text = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  const direct = options.find(option => option === text || option.replace(/-/g, " ") === text.replace(/-/g, " "));
  if (direct) return direct;
  const synonyms: Partial<Record<ScopeField, Array<[RegExp, string]>>> = {
    // The price book's tiers: semi-custom cabinetry is Mid-Range and custom is High-End, so
    // "semi-custom" is tested before "custom"; builder, production and stock are Builder Grade.
    finish: [[/luxur|bespoke|european|inset|top-of/, "luxury"], [/semi-?custom/, "mid-range"], [/premium|high|upgrad|upscale|designer|custom/, "high-end"], [/builder|production|stock|spec home|entry|budget|basic|econom|value|simple|refresh/, "refresh"], [/standard|mid|average|typical|good|common/, "mid-range"]],
    urgency: [[/emergenc|urgent|asap|immediate/, "emergency"], [/priorit|rush|soon|quick/, "priority"], [/standard|normal|flexible|no-rush|whenever/, "standard"]],
    complexity: [[/complex|difficult|structural|custom|challeng/, "complex"], [/standard|simple|typical|straightforward|normal/, "standard"]],
    garageIncluded: [[/^(yes|y|true|include|included|with-garage)$/, "yes"], [/^(no|n|false|exclude|excluded|none|without)/, "no"]],
  };
  for (const [pattern, option] of synonyms[field] || []) if (pattern.test(text) && options.includes(option)) return option;
  // A wording that contains exactly one option name means that option.
  const contained = options.filter(option => text.includes(option) || text.includes(option.replace(/-/g, " ")));
  return contained.length === 1 ? contained[0] : null;
}
export function validateAnswer(field: ScopeField, value: string): string | null {
  if (!Object.hasOwn(SCOPE_FIELDS,field)) return "Unknown field";
  if (typeof value !== "string" || value.length > SCOPE_TEXT_LIMIT) return "This text exceeds the request transport size. Upload it as an instruction document; do not shorten or omit instructions.";
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
  const retainedMetadata=(value:unknown,name:string):RetainedClarificationProvenance|undefined=>{
    if(value===undefined)return undefined;
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`Invalid ${name}`);
    const metadata=value as Record<string,unknown>;
    if(metadata.version!=="p5-retained-clarification-v1"||!Array.isArray(metadata.clarifications)||metadata.clarifications.length>100)throw new Error(`Invalid ${name}`);
    let serialized:string;
    try{serialized=JSON.stringify(value);}catch{throw new Error(`Invalid ${name}`);}
    if(serialized.length>500000)throw new Error(`Invalid ${name}`);
    return value as RetainedClarificationProvenance;
  };
  let clarificationProvenance=retainedMetadata(r.clarificationProvenance,"clarification provenance");
  const sourceHistory=retainedMetadata(r.sourceHistory,"source history");
  let laborCoverage:RetainedLaborCoverage|undefined;
  if(r.laborCoverage!==undefined){
    const coverage=r.laborCoverage as RetainedLaborCoverage;
    if(!coverage||coverage.basis!=='retained-document-clarification'||coverage.nonAdditiveSummary!==true
      ||!Number.isFinite(coverage.totalHours)||coverage.totalHours<=0
      ||!Array.isArray(coverage.components)||!coverage.components.length||coverage.components.length>100
      ||coverage.components.some(c=>!c||typeof c.id!=='string'||!c.id||c.id.length>200
        ||typeof c.description!=='string'||c.description.length>4000||!Number.isFinite(c.hours)||c.hours<=0)
      ||new Set(coverage.components.map(c=>c.id)).size!==coverage.components.length
      ||Math.abs(coverage.components.reduce((sum,c)=>sum+c.hours,0)-coverage.totalHours)>0.000001){
      throw new Error('Invalid non-additive labor coverage');
    }
    laborCoverage={...coverage,components:coverage.components.map(c=>({...c}))};
  }
  if (typeof r.summary !== "string" || !Array.isArray(r.facts) || !Array.isArray(r.conflicts)) throw new Error("Invalid scope analysis");
  // An over-long reply is trimmed, never discarded: a dense page that lists
  // more than the caps still yields its first facts and a note, instead of a
  // second provider call and an unread page.
  const trimmedNotes:string[]=[];
  if (r.summary.length > 8000) { r.summary = r.summary.slice(0, 8000); }
  if (r.facts.length > 150) { trimmedNotes.push(`${r.facts.length - 150} additional extracted facts beyond the first 150 were not used; confirm quantities against the document before pricing.`); r.facts = r.facts.slice(0, 150); }
  if (r.conflicts.length > 50) { r.conflicts = r.conflicts.slice(0, 50); }
  if (trimmedNotes.length) r.reviewNotes = [...(Array.isArray(r.reviewNotes) ? r.reviewNotes.filter(n => typeof n === "string") : []), ...trimmedNotes];
  // Cannot throw after trimming; restates the shape so the types below stay narrowed.
  if (typeof r.summary !== "string" || r.summary.length > 8000 || !Array.isArray(r.facts) || r.facts.length > 150 || !Array.isArray(r.conflicts) || r.conflicts.length > 50) throw new Error("Invalid scope analysis");
  const unreadValues: string[] = [];
  const takeoffs=r.takeoffs?readTakeoffs(r.takeoffs):undefined;
  const factsBeforeLaborAggregation = r.facts.flatMap((item: unknown): ExtractedFact[] => {
    if (!item || typeof item !== "object") throw new Error("Invalid fact");
    const f = {...item} as Record<string, unknown>;
    // Accept an explicit JSON number without changing its value or evidence.
    if(typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)&&SCOPE_FIELDS[f.field as ScopeField].kind==='number'&&typeof f.value==='number'&&Number.isFinite(f.value))f.value=String(f.value);
    // A blank optional slot is unknown, not a measurement and not a reason to
    // discard every other verified fact. Relevant missing fields are still asked.
    if(typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field)&&(f.value==null||typeof f.value==='string'&&!f.value.trim())){
      unreadValues.push(`Confirm ${SCOPE_FIELDS[f.field as ScopeField].label.toLowerCase()} if no other source supplies a readable value.`);
      return [];
    }
    if (typeof f.field === "string" && Object.hasOwn(SCOPE_FIELDS,f.field) && SCOPE_FIELDS[f.field as ScopeField].kind === "number" && typeof f.value === "string" && validateAnswer(f.field as ScopeField,f.value)) {
      unreadValues.push(`Confirm ${SCOPE_FIELDS[f.field as ScopeField].label.toLowerCase()} if no other source supplies a readable value.`);
      return [];
    }
    if (typeof f.field === "string" && Object.hasOwn(SCOPE_FIELDS,f.field) && SCOPE_FIELDS[f.field as ScopeField].kind === "choice" && typeof f.value === "string" && f.value.trim() && validateAnswer(f.field as ScopeField,f.value)) {
      const coerced = coerceChoice(f.field as ScopeField, f.value);
      if (coerced) f.value = coerced;
      else { unreadValues.push(`Confirm ${SCOPE_FIELDS[f.field as ScopeField].label.toLowerCase()} if no other source supplies a readable value.`); return []; }
    }
    const knownField=typeof f.field==='string'&&Object.hasOwn(SCOPE_FIELDS,f.field);
    // A fact filed under a name outside the vocabulary is never used, but it is not a reason to
    // discard the page's other facts and repair items. Live 2026-09-21: one such fact threw away
    // page 2 of an RE-10, items 5-8 went missing and the estimate was handed to a person.
    // No question stands behind an unknown name, so nothing is asked; the page's repair items and text still carry the work.
    if(!knownField)return [];
    const invalid=!knownField?'field':typeof f.value!=='string'||!f.value.trim()?'empty value':validateAnswer(f.field as ScopeField,f.value)?'value format':typeof f.confidence!=='number'||!Number.isFinite(f.confidence)||f.confidence<0||f.confidence>1?'confidence':typeof f.source!=='string'||!f.source.trim()||f.source.length>500?'source':typeof f.evidence!=='string'||!f.evidence.trim()||f.evidence.length>4000?'evidence':'';
    if(invalid)throw new Error(`Invalid extracted fact (${knownField?f.field:'unknown field'}: ${invalid})`);
    // The validation above narrows these at runtime. Never include the supplied
    // value, source text or evidence in an error log.
    const fact=f as typeof f & {field:ScopeField;value:string;confidence:number;evidence:string};
    if (f.basis !== undefined && !["stated", "calculated", "visual", "inferred"].includes(String(f.basis))) throw new Error("Invalid fact basis");
    // A model's confidence is not evidence that an assumption was supplied by the user.
    let confidence = fact.confidence;
    if (f.basis === "inferred") confidence = Math.min(confidence, .2);
    if (f.basis === "visual") confidence = Math.min(confidence, SCOPE_FIELDS[f.field as ScopeField].kind === "number" ? 0 : .6);
    const value=SCOPE_FIELDS[f.field as ScopeField].kind === "number" ? String(Number(fact.value.replaceAll(",", ""))) : fact.value.trim();
    // Keep an interpretation available for review, but do not let a
    // measurement named for a different assembly become a pricing answer.
    // Zero remains valid when the source explicitly says the component is
    // absent; an undocumented component is held instead of normalized to
    // zero. NUMERIC_EVIDENCE is declared below and is available when this
    // function is called after module initialization.
    const numericEvidence=NUMERIC_EVIDENCE[f.field as ScopeField];
    const assemblyMeasurement=f.field==="cabinetBaseLf"||f.field==="cabinetUpperLf"||f.field==="cabinetTallLf";
    const verifiedWidth=verifiedCabinetWidth(fact.field,value,fact.evidence);
    const explicitAbsence=value==="0"&&/\b(?:no|none|zero|without)\b.{0,30}\b(?:base|lower|upper|wall|tall|pantry|cabinet)\b/i.test(fact.evidence);
    if(assemblyMeasurement&&
      (numericEvidence&&!numericEvidence.test(fact.evidence)&&!explicitAbsence&&!verifiedWidth||
       value==="0"&&UNDOCUMENTED_QUANTITY.test(fact.evidence))){
      unreadValues.push(`Confirm ${SCOPE_FIELDS[f.field as ScopeField].label.toLowerCase()} from an explicit measurement before pricing.`);
      return [];
    }
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
  const laborAggregation=aggregateLaborFacts(factsBeforeLaborAggregation,takeoffs,laborCoverage);
  const facts=laborAggregation.facts;
  conflicts.push(...laborAggregation.conflicts);
  unreadValues.push(...laborAggregation.missingInformation);
  let validatedSourceHistory=sourceHistory;
  if(laborAggregation.replacedCanonicalFacts){
    const priorFacts=Array.isArray((sourceHistory as unknown as Record<string,unknown>|undefined)?.laborFacts)
      ? (sourceHistory as unknown as Record<string,unknown>).laborFacts as ExtractedFact[]
      : [];
    const laborFacts=[...priorFacts,...laborAggregation.originalFacts];
    const seenLaborFacts=new Set<string>();
    const retainedLaborFacts=laborFacts.filter(fact=>{
      const key=JSON.stringify([fact.field,fact.value,fact.source,fact.evidence]);
      if(seenLaborFacts.has(key))return false;
      seenLaborFacts.add(key);return true;
    });
    validatedSourceHistory={
      ...(sourceHistory||{version:'p5-retained-clarification-v1',clarifications:[]}),
      laborFacts:retainedLaborFacts,
    } as RetainedClarificationProvenance;
    if(clarificationProvenance){
      clarificationProvenance={
        ...clarificationProvenance,
        laborFacts:retainedLaborFacts,
      } as RetainedClarificationProvenance;
    }
  }
  // Independent conflict detection: never let a model overwrite two different measurements.
  for (const field of Object.keys(SCOPE_FIELDS) as ScopeField[]) {
    const values = [...new Set(facts.filter(f => f.field === field && f.confidence >= .4).map(f => f.value.trim()))];
    if (values.length > 1 && SCOPE_FIELDS[field].kind !== "text" && !conflicts.some(c => c.field === field)) conflicts.push({ field, values, explanation: "The supplied information contains different values. Please confirm the intended scope." });
  }
  // One malformed question must not discard a whole page read: on a live repair list that cost a
  // 34-second reread. A question filed under a field this estimator does not have is kept as a
  // general project detail, over-long text is shortened, and an entry with no question is dropped.
  const clarifications=Array.isArray(r.clarifications)?r.clarifications.flatMap((q:any)=>{
    if(!q||typeof q.question!=="string"||!q.question.trim())return [];
    const field=(typeof q.field==="string"&&Object.hasOwn(SCOPE_FIELDS,q.field)?q.field:"otherDetails") as ScopeField;
    return [{field,question:q.question.trim().slice(0,500),reason:typeof q.reason==="string"?q.reason.slice(0,1000):""}];
  }):[];
  const savedCoverage=r.documentCoverage as ScopeExtraction['documentCoverage']|undefined;
  const hasPages=r.pages!==undefined||savedCoverage!==undefined;
  const pages=hasPages?readPageRecords(r.pages??savedCoverage?.pages):[];
  const expectedPages=savedCoverage?.expectedPages??pages.length;
  if(!Number.isSafeInteger(expectedPages)||expectedPages<pages.length||expectedPages>10000)throw new Error('Invalid document page coverage');
  if(laborCoverage&&laborCoverage.components.some(component=>{
    const row=takeoffs?.find(item=>item.id===component.id);
    return !row||!/^(?:h|hr|hrs|hour|hours)$/i.test(row.unit)||row.quantity!==component.hours;
  }))throw new Error('Labor coverage does not match its active component takeoffs');
  return preserveIndependentQuestions({
    summary: r.summary, facts, conflicts,clarifications,
    ...(r.instructions?{instructions:validateInstructions(r.instructions)}:{}),
    ...(hasPages?{documentCoverage:{pages,expectedPages,complete:savedCoverage?.complete!==false&&pages.length===expectedPages&&pages.every(p=>p.status==='read')}}:{}),
    ...(takeoffs?{takeoffs}:{}),
    ...(clarificationProvenance?{clarificationProvenance}:{}),
    ...(validatedSourceHistory?{sourceHistory:validatedSourceHistory}:{}),
    ...(laborCoverage?{laborCoverage}:{}),
    missingInformation: [...strings(r.missingInformation, 50),...unreadValues],
    reviewNotes: strings(r.reviewNotes, 50)
  });
}
/** Broad text fields are not question identities. Route independent decisions
 * through the existing per-question answer protocol instead of overwriting
 * one shared field or discarding the second card. */
function preserveIndependentQuestions(extraction:ScopeExtraction):ScopeExtraction{
  const questions=extraction.clarifications||[];
  const independent=questions.filter(q=>SCOPE_FIELDS[q.field].kind==='text'&&!['location','address'].includes(q.field)&&questions.filter(other=>other.field===q.field).length>1);
  if(!independent.length)return extraction;
  const instructions=mergeInstructions(extraction.instructions?[extraction.instructions]:[]);
  instructions.questions=[...new Set([...instructions.questions,...independent.map(q=>q.question.trim()+(q.question.trim().endsWith('?')?'':'?')+(q.reason.trim()?' '+q.reason.trim():''))])];
  return {...extraction,instructions,clarifications:questions.filter(q=>!independent.includes(q))};
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
  cabinetTallLf:/\b(?:tall|pantry)\b.{0,40}\b(?:linear feet|linear foot|lf|run)\b|\b(?:linear feet|linear foot|lf|run)\b.{0,40}\b(?:tall|pantry)\b/i,
};
const UNDOCUMENTED_QUANTITY=/\b(?:unknown|not\s+(?:known|documented|specified|provided|measured|shown)|undocumented|unmeasured|tbd|n\/?a)\b/i;
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
    const explicitAbsence=fact.value.trim()==='0'&&/\b(?:no|none|zero|without)\b.{0,30}\b(?:base|lower|upper|wall|tall|pantry|cabinet)\b/i.test(fact.evidence);
    if(numericEvidence&&!verifiedCabinetWidth(fact.field,fact.value,fact.evidence)&&(!numericEvidence.test(fact.evidence)&&!explicitAbsence||DERIVED_MEASUREMENT.test(fact.evidence))){
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
    // Callers pass only facts they have already accepted; the project type is accepted at a lower bar (see reconcileScope).
    if (fact.confidence < (fact.field==='service'&&fact.basis==='stated'?.7:.85) || conflicts.some(c => c.field === fact.field)) continue;
    if(SCOPE_FIELDS[fact.field].kind==="text"){
      if(textFields.has(fact.field))continue;textFields.add(fact.field);
      const values=[...new Set([current[fact.field]?.trim(),...extraction.facts.filter(f=>f.field===fact.field&&f.confidence>=.85).map(f=>f.value.trim())].filter(Boolean))];
      const combined=[...new Set(values.flatMap(value=>value!.split("\n")).map(value=>value.trim()).filter(Boolean))].join("\n");
      if(combined.length<=SCOPE_TEXT_LIMIT)answers[fact.field]=combined;
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
  let clarificationProvenance=parts.find(p=>p.clarificationProvenance)?.clarificationProvenance;
  const sourceHistory=parts.find(p=>p.sourceHistory)?.sourceHistory;
  if(clarificationProvenance)merged.clarificationProvenance=clarificationProvenance;
  if(sourceHistory)merged.sourceHistory=sourceHistory;
  const laborCoverages=parts.flatMap(p=>p.laborCoverage?[p.laborCoverage]:[]);
  if(laborCoverages.length){
    if(laborCoverages.every(c=>JSON.stringify(c)===JSON.stringify(laborCoverages[0])))merged.laborCoverage=laborCoverages[0];
    else merged.missingInformation.push('Retained labor summaries differ; confirm the complete labor scope.');
  }
  const sourceTexts=parts.map(part=>part.sourceText).filter((text):text is string=>Boolean(text));
  if(sourceTexts.length)merged.sourceText=sourceTexts.join("\n\n");
  if(parts.some(p=>p.instructions))merged.instructions=mergeInstructions(parts.flatMap(p=>p.instructions?[p.instructions]:[]));
  const coverage=parts.flatMap(p=>p.documentCoverage?[p.documentCoverage]:[]);
  if(coverage.length)merged.documentCoverage=combineCoverage(coverage);
  const takeoffs=reconcileTakeoffs(parts.flatMap(p=>p.takeoffs||[]));
  if(takeoffs.items.length){merged.takeoffs=takeoffs.items;merged.missingInformation.push(...takeoffs.issues);}
  // A broad field can contain multiple independent decisions. Only collapse
  // an identical question, never all door/material/supply questions in it.
  const clarificationKey=(q:NonNullable<ScopeExtraction['clarifications']>[number])=>JSON.stringify([q.field,q.question.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()]);
  merged.clarifications=parts.flatMap(p=>p.clarifications||[]).filter((q,i,a)=>a.findIndex(v=>clarificationKey(v)===clarificationKey(q))===i);
  const seen=new Set<string>();
  for(const fact of parts.flatMap(p=>p.facts)){
    const key=JSON.stringify([fact.field,fact.value.trim(),fact.source,fact.evidence]);
    if(!seen.has(key)){seen.add(key);merged.facts.push(fact);}
  }
  const laborAggregation=aggregateLaborFacts(merged.facts,merged.takeoffs,merged.laborCoverage);
  merged.facts=laborAggregation.facts;
  merged.conflicts.push(...laborAggregation.conflicts);
  merged.missingInformation.push(...laborAggregation.missingInformation);
  if(laborAggregation.replacedCanonicalFacts){
    const historicalFacts=parts.flatMap(part=>{
      const history=part.sourceHistory as unknown as Record<string,unknown>|undefined;
      return Array.isArray(history?.laborFacts)?history.laborFacts as ExtractedFact[]:[];
    });
    const priorSource=sourceHistory as unknown as Record<string,unknown>|undefined;
    const priorFacts=Array.isArray(priorSource?.laborFacts)?priorSource.laborFacts as ExtractedFact[]:[];
    const allLaborFacts=[...priorFacts,...historicalFacts,...laborAggregation.originalFacts];
    const seenLaborFacts=new Set<string>();
    const retainedLaborFacts=allLaborFacts.filter(fact=>{
      const key=JSON.stringify([fact.field,fact.value,fact.source,fact.evidence]);
      if(seenLaborFacts.has(key))return false;
      seenLaborFacts.add(key);return true;
    });
    const laborHistory={
      ...(sourceHistory||{version:'p5-retained-clarification-v1',clarifications:[]}),
      laborFacts:retainedLaborFacts,
    } as RetainedClarificationProvenance;
    merged.sourceHistory=laborHistory;
    if(clarificationProvenance)clarificationProvenance={
      ...clarificationProvenance,
      laborFacts:retainedLaborFacts,
    } as RetainedClarificationProvenance;
  }
  if(clarificationProvenance)merged.clarificationProvenance=clarificationProvenance;
  for(const field of Object.keys(SCOPE_FIELDS) as ScopeField[]){
    const values=[...new Set(merged.facts.filter(f=>f.field===field&&f.confidence>=.4).map(f=>f.value.trim()))];
    if(values.length>1&&SCOPE_FIELDS[field].kind!=="text"&&!merged.conflicts.some(c=>c.field===field))merged.conflicts.push({field,values,explanation:"Different document pages state different values. Confirm the intended project information."});
  }
  // Missing questions from one page may be answered on another.
  merged.reviewNotes=reconcileReviewNotes(merged);
  merged.missingInformation=reconcileMissingInformation(merged);
  return preserveIndependentQuestions(merged);
}
/** blockingReviewNote lives in documentLedger.ts so page coverage and pricing share one rule. */
export {blockingReviewNote};
/** Words too generic to prove a note is answered: they appear in almost every
 * construction line item, so matching on them would discard real questions. */
const GENERIC_SUBJECT=new Set(['work','works','item','items','material','materials','labor','labour','hours','install','installation','installed','finish','finishes','finishing','spec','specs','specification','specifications','detail','details','scope','project','area','size','sizes','type','types','system','systems','concrete','wood','metal','paint','trim','unit','units','total','totals','quantity','quantities','dimension','dimensions','not','and','the','for','with','only','shown','stated','specified','provided','required','page','pages','per','this','that','from','all','new','existing']);
/** A note referring to the reader's own page or excerpt, meaningless once every
 * page of the document has been read. */
const PAGE_LOCAL=/\b(?:on|in|to|for)\s+this\s+(?:page|segment|section|sheet|excerpt|crop|view|group)\b|\bnot\s+(?:included|shown|present|visible|legible)\s+(?:in|on)\s+this\b|\bthis\s+(?:page|segment|section|excerpt)\s+(?:does\s+not|only)\b|\bpage\s+\d+[^.;]*\b(?:not\s+included|may\s+continue|continues?\s+(?:on|elsewhere))\b|\b(?:on|to)\s+(?:a\s+|the\s+)?(?:later|next|following|subsequent|other)\s+pages?\b|\b(?:may|might|could)\s+continue\b/i;
/** A note about money in the source document. The estimator never prices from a
 * number printed on an upload, so a missing or redacted price is not missing
 * project information. */
const SOURCE_PRICING=/\b(?:price|prices|pricing|cost|costs|unit\s+cost|rate|rates|dollar|amount|amounts|subtotal|total\s+cost|budget\s+figure)\b[^.;]*\b(?:redact|blank|remov|missing|not\s+(?:shown|stated|listed|provided|given))/i;
/** Contact and address detail the estimator deliberately never requires. */
const NEVER_REQUIRED=/\b(?:client|customer|owner|homeowner)\b[^.;]*\bnot\s+(?:specified|stated|provided|listed|given)\b|\b(?:mailing\s+)?address\b[^.;]*\bnot\s+(?:specified|stated|provided|listed|given)\b/i;
/** A note asking which specification applies - a thickness, strength, rating,
 * grade, model or finish. A takeoff proves how much work there is, never which
 * specification governs it, so takeoff evidence may not retire this question. */
const SPEC_QUESTION=/\b(?:thickness|thick|psi|grade|r-?value|u-?value|rating|rated|model|colou?r|species|gauge|class|strength|mix\s*design|spec|specs|specification|specifications|standard|tolerance|profile)\b/i;
const subjectWords=(note:string)=>new Set(note.toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w.length>3&&!GENERIC_SUBJECT.has(w)));
/** Drop a merged "missing information" note only when the combined record
 * proves it wrong: the page it was scoped to is no longer the whole document,
 * it asks for a source price the estimator does not use, it asks for a detail
 * that is never required, or a quantified takeoff names the same distinctive
 * subject. Anything still genuinely unanswered is kept, so a real gap is never
 * hidden from the visitor or from pricing. */
/** Drop a review note that was scoped to one page once every page has been
 * read, unless it is the kind of note that blocks pricing. A reader's "may
 * continue on the next page" is an artefact of reading one page at a time; it
 * is not a finding about the project, and it reached the visitor as a
 * question. Blocking notes are never touched, so an unread page still stops
 * the estimate. */
export function reconcileReviewNotes(merged:ScopeExtraction,blocking:(note:string)=>boolean=blockingReviewNote):string[]{
  const complete=merged.documentCoverage?merged.documentCoverage.complete&&merged.documentCoverage.pages.every(page=>page.status!=='unreadable'):false;
  if(!complete)return merged.reviewNotes;
  return merged.reviewNotes.filter(note=>blocking(note)||!PAGE_LOCAL.test(note));
}
export function reconcileMissingInformation(merged:ScopeExtraction):string[]{
  const complete=merged.documentCoverage?merged.documentCoverage.complete&&merged.documentCoverage.pages.every(page=>page.status!=='unreadable'):false;
  const quantified=(merged.takeoffs||[]).filter(t=>typeof t.quantity==='number'&&Number.isFinite(t.quantity));
  // Prefer the component, which names the thing itself ("rebar"), over the
  // description, which also carries the project subject ("...for driveway
  // slab"). Where no component is supplied, fall back to descriptions and
  // discard any word shared by most of them: a word naming the whole project
  // identifies nothing in particular and must not retire a question.
  const components=quantified.filter(t=>t.component.trim());
  const subjects=(components.length?components.map(t=>t.component):quantified.map(t=>t.description)).map(subjectWords);
  if(!components.length&&subjects.length>=4){
    const frequency=new Map<string,number>();
    for(const set of subjects)for(const word of set)frequency.set(word,(frequency.get(word)||0)+1);
    for(const set of subjects)for(const word of [...set])if((frequency.get(word)||0)*2>=subjects.length)set.delete(word);
  }
  const answered=subjects;
  const labelled=new Map<string,string>();
  for(const fact of merged.facts)if(fact.confidence>=.85&&fact.value.trim())labelled.set(SCOPE_FIELDS[fact.field].label.toLowerCase(),fact.value.trim());
  return merged.missingInformation.filter(note=>{
    const text=note.trim();if(!text)return false;
    if(complete&&PAGE_LOCAL.test(text))return false;
    if(SOURCE_PRICING.test(text))return false;
    if(NEVER_REQUIRED.test(text))return false;
    if(labelled.has(text.toLowerCase()))return false;
    if(SPEC_QUESTION.test(text))return true;
    const words=subjectWords(text);
    if(!words.size)return true;
    // One distinctive subject shared with a takeoff that carries a real
    // quantity means the document did state it; a generic overlap does not.
    return !answered.some(set=>[...words].some(word=>set.has(word)));
  });
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
