import {mergeScopeFacts,SCOPE_FIELDS,type ScopeAnswers,type ScopeConflict,type ScopeExtraction,type ScopeField} from './scope.ts';
import type {InstructionAnswer} from './clarifications.ts';

/**
 * The estimator has one visible project textbox. Older drafts can still have
 * the answer to the estimating-instructions question in a separate answer,
 * so comparisons must be made against a canonical text representation rather
 * than against the raw textarea value.
 */
export function normalizeScopeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

/** Text shown by the single project textbox for a draft. */
export function displayScopeText(text: string, estimatingInstructions?: string): string {
  return [text, estimatingInstructions].filter(value=>Boolean(value?.trim())).join('\n\n');
}

/**
 * A small deterministic fingerprint is sufficient for detecting stale
 * analysis. It is intentionally not a security token; draft credentials
 * remain the server's authentication mechanism.
 */
export function scopeFingerprint(text: string): string {
  const value = normalizeScopeText(text);
  let first = 2166136261;
  let second = 16777619;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + index;
    second = Math.imul(second, 2246822519);
  }
  return `scope-v1:${value.length}:${first >>> 0}:${second >>> 0}`;
}

export function scopeTextChanged(previous: string, incoming: string): boolean {
  return normalizeScopeText(previous) !== normalizeScopeText(incoming);
}

export interface ScopeSourceSnapshot {
  text: string;
  answers: ScopeAnswers;
  contact: {name: string; email: string; phone: string};
  wizard: ScopeReplacementWizard;
  analyzedFingerprint?: string;
}

type SourceSnapshotInput = Pick<AnalyzedScopeState, 'text'|'answers'|'wizard'|'analyzedFingerprint'> & {contact?: {name?: string; email?: string; phone?: string}};
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
}

/**
 * Capture only source-authored fields. Upload metadata and revision are
 * intentionally excluded: an upload request is allowed to add its own file,
 * but it cannot overwrite a newer text/answer/contact/wizard edit.
 */
export function sourceSnapshot(state: SourceSnapshotInput): ScopeSourceSnapshot {
  const contact=state.contact||{};
  const wizard=state.wizard||{skipped:[],resolutions:{},instructionAnswers:[]};
  return {
    text: normalizeScopeText(state.text),
    answers: {...state.answers},
    contact:{name:String(contact.name||'').trim(),email:String(contact.email||'').trim().toLowerCase(),phone:String(contact.phone||'').trim()},
    wizard:{
      skipped:[...(wizard.skipped||[])],
      resolutions:{...(wizard.resolutions||{})},
      ...(wizard.sourceVersion!==undefined?{sourceVersion:wizard.sourceVersion}:{}),
      instructionAnswers:[...(wizard.instructionAnswers||[])],
    },
  };
}

export function sourceSnapshotsEqual(expected: ScopeSourceSnapshot, actual: ScopeSourceSnapshot): boolean {
  return JSON.stringify(ordered(expected))===JSON.stringify(ordered(actual));
}

/**
 * Return the answer set for a replaced source. The source textbox is
 * authoritative: even a manually entered answer can describe the old
 * project (for example, a service, area or bathroom count), so retaining it
 * would silently mix two scopes. New facts can be collected from the fresh
 * text or the next wizard pass.
 */
export function answersForReplacedScope(
  current: ScopeAnswers,
  previousExtraction: ScopeExtraction | null,
  previousResolutions: ScopeAnswers = {},
  analyzedAnswers?: string,
): ScopeAnswers {
  // Keep the parameters in the public helper so callers can pass a complete
  // old state without first making unsafe assumptions about answer origin.
  void current;void previousExtraction;void previousResolutions;void analyzedAnswers;
  return {};
}

function sameScopeAnswer(field: ScopeField, first: string, second: string): boolean {
  if (SCOPE_FIELDS[field].kind === 'number') {
    const a = Number(first.replaceAll(',', ''));
    const b = Number(second.replaceAll(',', ''));
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

/**
 * Remove only values that came from the previous analysis. This is distinct
 * from a deliberate new-project replacement: while a homeowner is adding a
 * sentence to an existing scope, independent answers (location, selections,
 * responsibilities, and corrections) must remain available to the next
 * analysis.
 */
export function answersForEditedScope(
  current: ScopeAnswers,
  previousExtraction: ScopeExtraction | null,
  previousResolutions: ScopeAnswers = {},
  analyzedAnswers?: string,
): ScopeAnswers {
  const answers = {...current};
  const retainedHistory=previousExtraction&&(previousExtraction.clarificationProvenance||previousExtraction.sourceHistory);
  const clarificationFields=new Set<ScopeField>(
    (previousExtraction?.facts||[])
      .filter(fact=>/typed clarification/i.test(fact.source))
      .map(fact=>fact.field),
  );
  // Retained clarifications are visitor-authored decisions. Their structured
  // answers can be represented by an extraction fact, an instruction answer,
  // or both, so protect the complete active decision when its source-only
  // provenance is present.
  if(retainedHistory?.clarifications?.length){
    for(const field of ['estimatingInstructions','materials','cabinetConstruction','taskList','installation','exclusions','laborHours'] as ScopeField[])clarificationFields.add(field);
  }
  const sourceAnswers = previousExtraction ? mergeScopeFacts({}, previousExtraction).answers : {};
  for (const [field, value] of Object.entries(sourceAnswers) as [ScopeField, string][]) {
    const existing = answers[field];
    if (existing && !clarificationFields.has(field) && !previousResolutions[field] && sameScopeAnswer(field, existing, value)) delete answers[field];
  }
  // Do not rely only on the validated/merged view above. Older receipts may
  // contain a low-confidence, conflicted, or legacy fact that is no longer
  // admitted to mergeScopeFacts, while the corresponding answer still came
  // from that analysis (for example an 80 SF bathroom area). Raw extraction
  // values are historical provenance, not new pricing facts, so an unchanged
  // answer matching one must also be removed. Resolved visitor corrections
  // remain authoritative.
  for (const fact of previousExtraction?.facts || []) {
    const field = fact.field;
    const existing = answers[field];
    if (existing && !clarificationFields.has(field) && !previousResolutions[field] && sameScopeAnswer(field, existing, fact.value)) delete answers[field];
  }

  // Older drafts may have an analysis receipt without a complete extraction.
  // Its compact text-answer ledger is still enough to discard an unchanged
  // derived answer, without guessing about independently authored fields.
  if (analyzedAnswers) {
    try {
      const entries = JSON.parse(analyzedAnswers);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue;
          const field = entry[0] as ScopeField;
          if (!Object.hasOwn(SCOPE_FIELDS, field) || clarificationFields.has(field) || previousResolutions[field]) continue;
          const existing = answers[field];
          if (existing && sameScopeAnswer(field, existing, entry[1])) delete answers[field];
        }
      }
    } catch {
      // A malformed legacy ledger is not authoritative. Keep the authored
      // answer rather than risking data loss during an ordinary edit.
    }
  }
  return answers;
}

export interface ScopeReplacementWizard {
  skipped: ScopeField[];
  resolutions: ScopeAnswers;
  sourceVersion?: string;
  instructionAnswers?: InstructionAnswer[];
}

/** State shared by browser drafts and the server's persisted draft payload. */
export interface AnalyzedScopeState {
  text: string;
  answers: ScopeAnswers;
  extraction: ScopeExtraction | null;
  conflicts?: ScopeConflict[];
  wizard?: ScopeReplacementWizard;
  analyzedText?: string;
  analyzedAnswers?: string;
  analyzedFingerprint?: string;
  analysisWarning?: string;
  pendingReply?: {id: string; answer: string};
  pricedFields?: ScopeField[];
  reviewed?: unknown;
  scopeFingerprint?: string;
  step?: number;
  dirty?: boolean;
}

/**
 * Invalidate all answer state for a deliberate source replacement. The
 * browser uses a new draft ID for the normal UI path; this helper remains
 * useful for explicit server-side replacement requests.
 */
export function replaceAnalyzedScope<T extends AnalyzedScopeState>(state: T, text: string): T {
  const answers = answersForReplacedScope(state.answers, state.extraction, state.wizard?.resolutions, state.analyzedAnswers);
  return {
    ...state,
    text: normalizeScopeText(text),
    answers,
    extraction: null,
    conflicts: [],
    wizard: {skipped: [], resolutions: {}, instructionAnswers: []},
    analyzedText: undefined,
    analyzedAnswers: undefined,
    analyzedFingerprint: undefined,
    analysisWarning: undefined,
    pendingReply: undefined,
    pricedFields: [],
    reviewed: null,
    scopeFingerprint: undefined,
    step: 0,
    dirty: true,
  };
}

/** Invalidate analysis for an ordinary additive/editing change. */
export function refreshAnalyzedScope<T extends AnalyzedScopeState>(state: T, text: string): T {
  const answers = answersForEditedScope(state.answers, state.extraction, state.wizard?.resolutions, state.analyzedAnswers);
  return {
    ...state,
    text: normalizeScopeText(text),
    answers,
    extraction: null,
    conflicts: [],
    wizard: {skipped: [], resolutions: {}, instructionAnswers: []},
    analyzedText: undefined,
    analyzedAnswers: undefined,
    analyzedFingerprint: undefined,
    analysisWarning: undefined,
    pendingReply: undefined,
    pricedFields: [],
    reviewed: null,
    scopeFingerprint: undefined,
    step: 0,
    dirty: true,
  };
}

/** Whether a draft's saved analysis still belongs to the supplied text. */
export function analyzedScopeMatches(state: Pick<AnalyzedScopeState, 'text'|'analyzedText'|'analyzedFingerprint'>, text = state.text): boolean {
  if (state.analyzedFingerprint) return state.analyzedFingerprint === scopeFingerprint(text);
  if (state.analyzedText !== undefined) return normalizeScopeText(state.analyzedText) === normalizeScopeText(text);
  return true;
}