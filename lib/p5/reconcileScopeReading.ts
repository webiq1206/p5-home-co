import {applyIntakeIntent} from './intakeIntent.ts';
import {publicProjectMode} from './intakePolicy.ts';
import {createHash} from 'node:crypto';
import {applyCabinetIntent} from './projectIntent.ts';
import {groundSourceResponsibilities} from './sourceResponsibilities.ts';
import {reconcileScope} from './adaptive.ts';
import {SCOPE_FIELDS,validateExtraction,type ScopeAnswers} from './scope.ts';
import {scopeFingerprint} from './scopeReplacement.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {impliedComponentRemodel,impliedRepairService,serviceEvidenceSupports} from './serviceSignals.ts';
import {reconcileDocumentHierarchy,groundDocumentConditions,normalizeCountSubjects,normalizeDimensionSubjects,normalizeTileSubjects,separateFootprintFromInstallation} from './scopeInterpretation.ts';
import {applyExplicitTypedCorrections,answersAfterTypedRevision} from './typedCorrections.ts';
import type {Draft} from './store.ts';
import type {AnalysisResult} from './extraction.ts';

/** Shared deterministic reconciliation for a verified reading. No I/O, provider
 * dispatch, work scheduling or mutation of the retained reading occurs here. */
export function reconcileScopeReading(analysisDraft:Draft,text:string,visitorAnswers:ScopeAnswers,reading:AnalysisResult|null,{sourceChanged=false,warning='',failedSourceNotes=[]}:{sourceChanged?:boolean;warning?:string;failedSourceNotes?:string[]}={}){
    let analysis=reading?structuredClone(reading):null;
    const version=createHash('sha256').update(JSON.stringify([text,analysisDraft.uploads.map(f=>f.sha256)])).digest('hex');
    const resolutions=analysisDraft.wizard?.sourceVersion===version?{...analysisDraft.wizard.resolutions}:{};
    // Copy before applying intent: a stored or reused result must never be mutated in place.
    if(analysis)analysis={...analysis,extraction:applyCabinetIntent(text,ESTIMATOR_BRAND.services,visitorAnswers,validateExtraction(groundSourceResponsibilities(analysis.extraction,analysis.extraction.sourceText,text,visitorAnswers))).extraction!};
    // A repair-only site prices a plain repair request as home repairs instead of asking the customer
    // to pick "Home repairs" from a menu of repair types (live Handyman baseboard, 2026-09-24/25). The
    // type is supplied as a source-derived fact, exactly like the Cabinet intent above, and it is
    // part of the SAVED extraction: a manual answer would change the analysis identity on the next
    // request and re-read every finished section (CI resumable check, 2026-09-25). Any RE-10, rush or
    // change-order signal keeps the question, and the type stays editable on the review screen.
    if(analysis&&!visitorAnswers.service&&!analysis.extraction.conflicts.some((c:{field:string})=>c.field==='service')){
      const facts=analysis.extraction.facts;
      // A reader classification stands whether or not this site offers it: a bathroom remodel typed on
      // the Handyman site is handed to Remodeling, never re-labelled as home repairs. Only when the
      // reader gave no usable type (nothing, a low-confidence guess, or an RE-10/rush/change-order
      // claim without the customer's signal) does the repair-only default apply.
      const supported=facts.some(f=>f.field==='service'&&f.confidence>=.7&&f.basis!=='inferred'&&f.basis!=='visual'&&(SCOPE_FIELDS.service.options as readonly string[]).includes(f.value)&&serviceEvidenceSupports(f.value,f.evidence));
      const implied=supported?null:(impliedComponentRemodel(text,ESTIMATOR_BRAND.services as readonly string[])||impliedRepairService([text,...facts.map(f=>f.evidence)].join('\n'),ESTIMATOR_BRAND.services as readonly string[]));
      if(implied)analysis={...analysis,extraction:{...analysis.extraction,facts:[...facts.filter(f=>f.field!=='service'),{field:'service',value:implied,confidence:1,source:'typed scope',evidence:text.slice(0,4000),basis:'stated'}]}};
    }
    if(analysis)analysis={...analysis,extraction:groundDocumentConditions(reconcileDocumentHierarchy(normalizeDimensionSubjects(normalizeCountSubjects(applyExplicitTypedCorrections(validateExtraction(normalizeTileSubjects(separateFootprintFromInstallation(analysis.extraction,text))),text)),text),text),text)};
    let extraction=analysis?.extraction||analysisDraft.extraction;
    const merged=analysis?reconcileScope(answersAfterTypedRevision(visitorAnswers,analysis.extraction,text,resolutions),analysis.extraction,resolutions):{answers:{...analysisDraft.answers,...visitorAnswers},conflicts:[]};
    if(publicProjectMode(ESTIMATOR_BRAND.id,merged.answers.service)==='review'){
      const interpreted=applyIntakeIntent(text,merged.answers,extraction,resolutions);merged.answers=interpreted.answers;extraction=interpreted.extraction;
      if(interpreted.clearServiceResolution)delete resolutions.service;
      merged.conflicts=extraction?reconcileScope(merged.answers,extraction,resolutions).conflicts:merged.conflicts;
    }
    const wizard={instructionAnswers:sourceChanged?[]:analysisDraft.wizard?.instructionAnswers||[],skipped:sourceChanged?[]:analysisDraft.wizard?.skipped||[],resolutions,sourceVersion:analysis?version:sourceChanged?undefined:analysisDraft.wizard?.sourceVersion};
    // Partial analysis is visible and prevents unread documents from being priced.
    const safeExtraction=warning?{...extraction,summary:extraction?.summary||text,facts:extraction?.facts||[],conflicts:extraction?.conflicts||[],missingInformation:extraction?.missingInformation||[],reviewNotes:[...new Set([...(extraction?.reviewNotes||[]),...failedSourceNotes,warning])]}:extraction;
    const analyzedAnswers=analysis?JSON.stringify(Object.entries(merged.answers).filter(([field,value])=>SCOPE_FIELDS[field as keyof typeof SCOPE_FIELDS].kind==='text'&&value?.trim()).sort(([a],[b])=>a.localeCompare(b))):undefined;
    return {analysis,conflicts:merged.conflicts,payload:{text,answers:merged.answers,extraction:safeExtraction,reviewed:null,contact:analysisDraft.contact,wizard,analyzedFingerprint:analysis?scopeFingerprint(text):undefined,analyzedAnswers}};
}
