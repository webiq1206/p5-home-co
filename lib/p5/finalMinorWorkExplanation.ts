import type {ScopePriceResolution} from './costBook.ts';
import type {DirectCostLine} from './pricing.ts';
import {MINOR_WORK_POLICY,minorWorkEligible} from './minorWorkAllowance.ts';
import {priceBookRates} from './priceBook.ts';
import type {PlanningRate} from './planningBooks.ts';
import {resolveAdvisoryProvenance,type AdvisoryReviewRecord,type AdvisoryDisposition} from './advisoryProvenance.ts';

type Task={id:string;description:string;evidence?:string;researchDescription?:string;existingLineIds?:string[];issues?:string[]};
type Audit={tasks:Task[];issues?:string[];advisoryProvenance?:AdvisoryReviewRecord[];verification?:{issues?:string[];resolvedIssues?:{issue:string;reason:string;lineIds:string[]}[]}};
export type CurrentFinding={kind:'coverage'|'overlap'|'current-issue'|'historical-review';message:string;lineIds:string[];taskIds:string[];original?:string};
export type FinalMinorWorkExplanation={version:'retained-minor-work-v1';notes:string[];findings:CurrentFinding[];
  coverage:{taskId:string;lineIds:string[];allowanceComponents:string[];source:'structured-policy'|'legacy-exact-match'|'none'}[];
  historicalAssumptions:string[];advisoryDisposition?:AdvisoryDisposition};
const unique=(values:string[])=>[...new Set(values)];

/** A current-state explanation is not another interpretation of old prose.
 * It states only retained quantities and explicit policy assignments. Historical
 * concerns have no typed, current-state disposition in old cache entries: they
 * remain pending review, never silently become confirmed coverage. */
export function finalMinorWorkExplanation(resolution:ScopePriceResolution,lines:DirectCostLine[],audit:Audit,answers:{service?:string;finish?:string}={},approvedRates:PlanningRate[]=[]):FinalMinorWorkExplanation|null{
 if(!resolution.rules.some(rule=>rule.id==='minor-work-allowance')&&!audit.tasks.some(task=>task.existingLineIds?.includes('minor-work-allowance')))return null;
 const live=lines.filter(line=>line.quantity>0&&line.unitCost>0);
 const ids=new Set(live.map(line=>line.id));
 const rules=resolution.rules.filter(rule=>ids.has(rule.id));
 const pool=rules.find(rule=>rule.id==='minor-work-allowance'&&rule.category==='other-direct'&&rule.allowance
  &&rule.unit==='job'&&rule.quantity.fixed===1&&rule.quantity.factor===1
  &&rule.unitCost>=MINOR_WORK_POLICY.minimum&&rule.unitCost<=MINOR_WORK_POLICY.maximum
  &&rule.evidence.basis==='owner-budget-allowance'&&rule.evidence.reference.startsWith(MINOR_WORK_POLICY.version+';')
  &&live.some(line=>line.id===rule.id&&line.quantity===1&&line.unitCost===rule.unitCost));
 const notes:string[]=[],findings:CurrentFinding[]=[],coverage:FinalMinorWorkExplanation['coverage']=[];
 const catalog=[...approvedRates,...priceBookRates(answers)];
 const canonical=(line:DirectCostLine)=>catalog.find(rate=>line.evidence.reference.startsWith(rate.source+'; '+rate.code+';')&&rate.unit===line.unit&&rate.amount===line.unitCost
  &&(rate.type==='Labor'?line.category==='field-labor':rate.type==='Material'?line.category==='materials':rate.type==='Subcontractor'?line.category==='subcontractors':true));
 const add=(finding:CurrentFinding)=>{if(!findings.some(item=>item.kind===finding.kind&&item.message===finding.message&&item.original===finding.original))findings.push(finding);};
 const links=(task:Task)=>unique([...(task.existingLineIds||[]),...rules.filter(rule=>rule.scopeTaskId===task.id).map(rule=>rule.id)]).filter(id=>ids.has(id));
 for(const task of audit.tasks){
  const lineIds=links(task);
  const structured=pool?.minorWorkCoverage?.filter(item=>item.taskId===task.id&&item.description===task.description)||[];
  const legacy=pool&&!pool.minorWorkCoverage?.some(item=>item.taskId===task.id||item.description===task.description)&&pool.evidence.reference.split('\nCovered work:\n')[1]?.split('\n').includes(task.description)
   &&minorWorkEligible({id:task.id,description:task.description,evidence:task.evidence||'',existingLineIds:task.existingLineIds||[],researchDescription:task.description});
  const assigned=Boolean(pool&&lineIds.includes(pool.id)&&(structured.length||legacy));
  const components=assigned?unique(structured.length?structured.map(item=>item.remainingComponent):[task.description]):[];
  coverage.push({taskId:task.id,lineIds,allowanceComponents:components,source:assigned?(structured.length?'structured-policy':'legacy-exact-match'):'none'});
  if(!lineIds.length||task.researchDescription||lineIds.includes('minor-work-allowance')&&!assigned){
   add({kind:'coverage',message:`Confirm the unverified pricing coverage for: ${task.description}`,taskIds:[task.id],lineIds});
  }
  // A policy assignment is a budget, not proof that another material charge
  // serves a different physical component. Keep both prices and flag overlap.
  const material=lineIds.filter(id=>live.some(line=>line.id===id&&(line.category==='materials'||line.category==='subcontractors')));
  if(assigned&&material.length)add({kind:'overlap',message:`Confirm the separate material or installed charge and shared allowance do not cover the same work: ${task.description}`,taskIds:[task.id],lineIds});
  for(const original of task.issues||[])add({kind:'current-issue',message:original,original,taskIds:[task.id],lineIds});
 }
 if(!pool)add({kind:'coverage',message:'The shared job-support allowance has no valid positive policy assignment. Confirm supporting-work pricing.',lineIds:live.filter(line=>line.id==='minor-work-allowance').map(line=>line.id),taskIds:coverage.filter(item=>item.lineIds.includes('minor-work-allowance')).map(item=>item.taskId)});
 for(const line of live){
  if(line.id==='minor-work-allowance')continue;
  // The itemized description is retained, but free-text quantity evidence is
  // never promoted to a rate inclusion or a customer pricing explanation.
  const rate=canonical(line);
  const description=rate?.type==='Labor'?rate.description.split(' (')[0]+'; labor only, materials priced separately':rate?.description||line.description;
  notes.push(`Retained priced work: ${description}. Quantity: ${line.quantity} ${line.unit}.`);
  if(!rate&&line.evidence.reference.includes('PB-'))add({kind:'coverage',message:'A retained price-book line could not be matched exactly to its source, unit and rate. Its inclusions require review.',lineIds:[line.id],taskIds:rules.filter(rule=>rule.id===line.id&&rule.scopeTaskId).map(rule=>rule.scopeTaskId!)});
 }
 const labor=live.filter(line=>line.category==='field-labor');
 for(let i=0;i<labor.length;i++)for(let j=i+1;j<labor.length;j++){
  const a=labor[i],b=labor[j],rate=canonical(a);
  if(rate&&canonical(b)?.code===rate.code&&a.quantity===b.quantity&&a.building===b.building&&a.floor===b.floor)
   add({kind:'overlap',message:'Two retained labor charges use the same rate, quantity and location. Confirm they represent distinct work before relying on the total.',lineIds:[a.id,b.id],taskIds:rules.filter(rule=>(rule.id===a.id||rule.id===b.id)&&rule.scopeTaskId).map(rule=>rule.scopeTaskId!)});
 }
 if(pool){
  // Remaining-component evidence can contain internal research instructions.
  // Customer wording names its associated task; component details stay in the
  // structured internal record and never masquerade as an included assembly.
  const associated=unique(audit.tasks.filter(task=>coverage.some(item=>item.taskId===task.id&&item.allowanceComponents.length)).map(task=>task.description.replace(/[.;\s]+$/,'')));
  notes.push(associated.length?`One shared preliminary job-support allowance budgets supporting work associated with: ${associated.join('; ')}. Primary labor and products remain separately itemized. Confirm the budget against actual site conditions before a firm proposal.`:'The shared preliminary job-support allowance has no verified task assignment; review is required.');
 }
 for(const original of resolution.issues)add({kind:'current-issue',message:original,original,lineIds:[...ids],taskIds:[]});
 const disposition=audit.advisoryProvenance?.length?resolveAdvisoryProvenance(audit.advisoryProvenance,live,audit.tasks,new Set(live.filter(line=>canonical(line)).map(line=>line.id)),coverage):undefined;
 for(const advisory of disposition?.advisories||[])notes.push(advisory.message);
 for(const blocker of disposition?.blockers||[])add({kind:'current-issue',...blocker,lineIds:blocker.lineIds.length?blocker.lineIds:[...ids]});
 const reviewed=new Set(disposition?.reviewedTexts||[]);
 const pending='Earlier scope and pricing assumptions remain pending review before a firm proposal.';
 // Preserve all historical audit concerns as pending. Matching live line IDs
 // alone cannot prove that a quantity, hazard, or scope concern was resolved.
 const historical=unique([...(audit.issues||[]),...(audit.verification?.issues||[])]);
 for(const original of historical){
  if(resolution.issues.includes(original))continue;
  if(reviewed.has(original))continue;
  const taskIds=audit.tasks.filter(task=>original.includes(task.id)||original.includes(task.description)).map(task=>task.id);
  const lineIds=unique([...live.filter(line=>original.includes(line.id)).map(line=>line.id),...coverage.filter(item=>taskIds.includes(item.taskId)).flatMap(item=>item.lineIds)]);
  add({kind:'historical-review',original,lineIds:lineIds.length?lineIds:[...ids],taskIds,
   message:pending});
 }
 // Unknown prose has no trustworthy proposal/advisory discriminator. Keep it
 // internally and disclose the review requirement, rather than guessing which
 // of its assertions is still true. No broad keyword suppression is used.
 const unresolved=resolution.assumptions.filter(note=>!reviewed.has(note)&&!reviewed.has(note.replace(/^To confirm:\s*/i,''))
  &&!audit.verification?.resolvedIssues?.some(item=>reviewed.has(item.issue)&&note===`${item.issue} Review evidence: ${item.reason}`));
 if(unresolved.length||disposition?.invalid.length)add({kind:'historical-review',message:pending,lineIds:[...ids],taskIds:[]});
 return {version:'retained-minor-work-v1',notes:[...new Set(notes)],findings,coverage,historicalAssumptions:[...resolution.assumptions],...(disposition?{advisoryDisposition:disposition}:{})};
}
