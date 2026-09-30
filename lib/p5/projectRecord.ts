import {createHash} from 'node:crypto';
import type {ReviewedScope} from './scope.ts';
import {projectUnit,sameProjectDimension,combineProjectUnits,sourceNumbers} from './projectUnits.ts';
import {PROJECT_RECORD_VERSION,projectProposalSchema,type ProjectProposal,type ProjectQuantityValue,type ProjectQuestion} from './projectRecordContracts.ts';
import type {ProjectChange} from './projectConversation.ts';
import type {ProjectPageEvidence} from './projectPageEvidence.ts';
import {quotationFeedback} from './quotationFeedback.ts';

export interface ProjectSource {
 id:string;kind:'customer-text'|'reviewed-answer'|'document-transcript'|'native-page-text'|'page-layout'|'reader-observation'|'customer-clarification'|'customer-revision';
 name:string;fileId:string|null;page:number|null;text:string;sha256:string;
 status:'read'|'partial'|'unreadable';
}
export interface ProjectInput {sources:ProjectSource[];sourceHash:string;documentIssues:string[]}
export interface ProjectScope extends ReviewedScope {answerOrigins?:Record<string,'customer'|'reader'|'unconfirmed'>;pageEvidence?:ProjectPageEvidence}
export interface ProjectRecord extends ProjectProposal {
 version:typeof PROJECT_RECORD_VERSION;revision:number;sourceHash:string;recordHash:string;
 sources:ProjectSource[];createdAt:string;
}
export interface RecordProblem {code:string;ids:string[];message:string}
export class ProjectRecordError extends Error {
 readonly problems:RecordProblem[];
 constructor(problems:RecordProblem[]){super('Project record needs correction');this.name='ProjectRecordError';this.problems=problems;}
}
// Database JSON objects may return in a different key order. Identity depends
// on content, never serialization order; array order still carries meaning.
export const projectHash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)).digest('hex');
const normalized=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
const unique=(values:string[])=>[...new Set(values)];
/** Visit each dependency once. Shared prerequisites in a large project must
 * not turn cycle validation into repeated traversal of every possible path. */
function graphCycles(edges:Map<string,string[]>):string[][]{
 const done=new Set<string>(),active=new Map<string,number>(),path:string[]=[],cycles:string[][]=[];
 const visit=(id:string)=>{
  const start=active.get(id);if(start!==undefined){cycles.push([...path.slice(start),id]);return;}
  if(done.has(id))return;active.set(id,path.length);path.push(id);
  for(const next of edges.get(id)||[])if(edges.has(next))visit(next);
  path.pop();active.delete(id);done.add(id);
 };
 for(const id of edges.keys())visit(id);return cycles;
}

/** All characters are retained. Splitting is transport organization, never
 * page sampling. Each block remains independently addressable and hashed. */
function sourceBlocks(text:string,limit=18000){
 const output:{text:string;start:number}[]=[];let start=0;
 while(start<text.length){
  let end=Math.min(text.length,start+limit);
  if(end<text.length){const boundary=text.lastIndexOf('\n',end);if(boundary>start+limit/2)end=boundary+1;}
  output.push({text:text.slice(start,end),start});start=end;
 }
 return output;
}
export function projectInput(scope:ProjectScope,changes:ProjectChange[]=[]):ProjectInput{
 const sources:ProjectSource[]=[],documentIssues:string[]=[...(scope.pageEvidence?.issues||[])];
 const add=(kind:ProjectSource['kind'],name:string,text:string,fileId:string|null=null,page:number|null=null,status:ProjectSource['status']='read')=>{
  if(!text.trim())return;
  for(const block of sourceBlocks(text)){
   const sha256=projectHash({kind,name,fileId,page,text:block.text,start:block.start});
   sources.push({id:'src-'+sha256.slice(0,20),kind,name,fileId,page,text:block.text,sha256,status});
  }
 };
 add('customer-text','Current customer scope',scope.text);
 for(const [field,value]of Object.entries(scope.answers).sort(([a],[b])=>a.localeCompare(b)))if(value?.trim()){
  const origin=scope.answerOrigins?.[field]||'customer';
  add(origin==='customer'?'reviewed-answer':'reader-observation',`${origin==='customer'?'Customer answer':origin==='reader'?'Previously extracted answer, not customer confirmation':'Saved answer with unconfirmed origin'}: ${field}`,field+': '+value);
 }
 const extraction=scope.extraction;
 if(extraction?.sourceText)add('document-transcript','Retained reader transcript; verify against page observations',extraction.sourceText);
 const seenFiles=new Set<string>();let legacyFiles=0;
 for(const upload of scope.uploads){
  if(seenFiles.has(upload.sha256))continue;seenFiles.add(upload.sha256);
  const native=scope.pageEvidence?.documents.find(document=>document.sha256===upload.sha256&&document.fileId===upload.id);
  if(native){
   if(native.pages.length!==native.pageCount||native.pages.some((p,i)=>p.number!==i+1))documentIssues.push('Original page inventory is inconsistent for '+native.name);
   for(const page of native.pages){
    const status=page.status==='pending'?'partial':page.status;
    const name=`${native.name}, page ${page.number}`;
    add('native-page-text',name+' original text',page.native.text,upload.id,page.number,status);
    add('page-layout',name+' digital page geometry; not physical construction dimensions',JSON.stringify({fileSha256:native.sha256,readerRevision:native.revision,kind:page.native.kind,textQuality:page.native.textQuality,width:page.native.width,height:page.native.height,spanCoordinates:page.native.spanCoordinates,spans:page.native.spans}),upload.id,page.number,status);
    add('reader-observation',name+' model interpretation; verify against original evidence',JSON.stringify({status:page.status,notes:page.notes,observation:page.readerObservation}),upload.id,page.number,status);
   }
   continue;
  }
  legacyFiles++;
  const name=scope.uploads.some(other=>other.sha256!==upload.sha256&&other.name===upload.name)?`${upload.name} [${upload.id.slice(0,8)}]`:upload.name;
  const pages=(extraction?.documentCoverage?.pages||[]).filter(p=>p.source===name);
  if(upload.status!=='stored'||!pages.length)documentIssues.push('No completed page inventory for '+upload.name);
  for(const page of pages){
   const takeoffs=(extraction?.takeoffs||[]).filter(t=>t.sources.some(s=>s.source===upload.name&&s.page===page.page));
   const facts=(extraction?.facts||[]).filter(f=>f.source===upload.name);
   add('reader-observation',`${upload.name}, page ${page.page}`,JSON.stringify({page,takeoffs,...(pages.length===1?{facts}:{})}),upload.id,page.page,page.status);
   // A known partial page reaches interpretation as an unresolved source so
   // it can produce a specific clarification. Missing inventory still blocks.
  }
 }
 if(legacyFiles&&(!extraction?.documentCoverage||extraction.documentCoverage.pages.length!==extraction.documentCoverage.expectedPages))documentIssues.push('Document page coverage is incomplete or inconsistent.');
 // Facts from a reader are observations, not fresh customer answers. Keep all
 // details even when a legacy field cannot represent several rooms or items.
 if(extraction)add('reader-observation','Reader facts and takeoffs',JSON.stringify({summary:extraction.summary,facts:extraction.facts,takeoffs:extraction.takeoffs||[],conflicts:extraction.conflicts,instructions:extraction.instructions||null,reviewNotes:extraction.reviewNotes}));
 for(const change of changes)add(change.kind==='answer'?'customer-clarification':'customer-revision',`Customer update ${change.sequence}, draft revision ${change.draftRevision}`,`Question: ${change.prompt}\nCustomer response: ${change.response}\nRelated requirement IDs: ${change.requirementIds.join(', ')}\nRelated quantity IDs: ${change.quantityIds.join(', ')}`);
 return {sources,sourceHash:projectHash(sources),documentIssues:unique(documentIssues)};
}

export function computedProjectQuantity(quantity:ProjectQuantityValue,quantities:ProjectQuantityValue[],visiting=new Set<string>()):number|null{
 if(visiting.has(quantity.id))throw new ProjectRecordError([{code:'quantity-cycle',ids:[quantity.id],message:'Quantity calculations contain a cycle.'}]);
 if(quantity.basis!=='calculated')return quantity.value;
 const expression=quantity.calculation;if(!expression)return null;
 const output=projectUnit(quantity.unit);if(!output)return null;
 const seen=new Set(visiting).add(quantity.id);
 const inputs=expression.inputIds.map(id=>quantities.find(q=>q.id===id));
 if(inputs.some(q=>!q)||!inputs.length)return null;
 const measures=inputs.map(q=>projectUnit(q!.unit));if(measures.some(m=>!m))return null;
 const values=inputs.map(q=>computedProjectQuantity(q!,quantities,seen));if(values.some(v=>v===null))return null;
 const normalizedValues=values.map((v,i)=>v!*measures[i]!.scale);
 let result:number;
 if(expression.operation==='sum'||expression.operation==='difference'){
  if(measures.some(m=>!sameProjectDimension(m!,output))||(expression.operation==='difference'&&inputs.length!==2))return null;
  result=expression.operation==='sum'?normalizedValues.reduce((a,b)=>a+b,0):normalizedValues[0]-normalizedValues[1];
 }else{
  if(expression.operation==='ratio'&&(inputs.length!==2||normalizedValues[1]===0))return null;
  const dimension=measures.slice(1).reduce((unit,next)=>combineProjectUnits(unit!,next!,expression.operation==='ratio'),measures[0]);
  // Equal physical dimensions divided by one another produce a count of
  // units. Named packaging requires an explicit coverage unit such as SF/box.
  const scalarCount=expression.operation==='ratio'&&Object.keys(dimension!.powers).length===0&&Object.keys(output.powers).length===1&&output.powers['count:each']===1;
  if(!sameProjectDimension(dimension!,output)&&!scalarCount)return null;
  result=expression.operation==='product'?normalizedValues.reduce((a,b)=>a*b,1):normalizedValues[0]/normalizedValues[1];
 }
 if(!Number.isFinite(result)||result<0)return null;
 return result*expression.factor/output.scale;
}

/** Shared arithmetic/evidence validation. Physical quantities belong to
 * subjects; estimating quantities belong to explicitly linked work groups. */
export function validateProjectQuantities(values:ProjectQuantityValue[],entries:ProjectProposal['evidence']):RecordProblem[]{
 const issues:RecordProblem[]=[],evidence=new Map(entries.map(e=>[e.id,e])),quantities=new Map(values.map(q=>[q.id,q]));
 const issue=(code:string,ids:string[],message:string)=>issues.push({code,ids,message});
 const seen=new Set<string>();for(const q of values){if(seen.has(q.id))issue('duplicate-id',[q.id],'Quantity IDs must be unique.');seen.add(q.id);}
 const checkEvidence=(ids:string[],owner:string)=>{for(const id of ids)if(!evidence.has(id))issue('unknown-evidence',[owner,id],'Referenced evidence does not exist.');};
 for(const q of values){
  if(!(q.basis==='unknown'&&q.unit===null)&&!projectUnit(q.unit))issue('unsupported-unit',[q.id],'Quantity unit is not supported: '+q.unit+'. Use a supported measurement unit, or null only while the physical quantity is unknown and requires clarification.');
  checkEvidence(q.evidenceIds,q.id);
  if(q.basis==='unknown'&&(q.value!==null||q.range!==null||q.calculation!==null))issue('invented-quantity',[q.id],'An unknown quantity cannot contain a measured value, range or calculation.');
  if(q.basis!=='unknown'&&(q.value===null||q.value<0))issue('missing-quantity',[q.id],'A known physical quantity must be nonnegative. Charged quantities must be positive.');
  if(q.basis==='stated'&&(!q.evidenceIds.length||q.range!==null||q.calculation!==null))issue('stated-evidence',[q.id],'Stated quantities require source evidence, without a modeled range or formula.');
  if(q.basis==='stated'&&q.value!==null){
   const values=sourceNumbers(q.evidenceIds.map(id=>evidence.get(id)?.quote||'').join(' '));
   if(!values.includes(q.value))issue('unstated-value',[q.id],'This numeric value is absent from its cited evidence; use a supported calculation or disclose an allowance.');
  }
  if(q.basis==='allowance'&&(!q.assumption.trim()||!q.range||q.range.low<=0||q.value===null||q.range.low>q.value||q.range.high<q.value||q.calculation!==null))issue('allowance-basis',[q.id],'An allowance needs a reason and positive range containing the budget quantity.');
  if(q.basis==='calculated'){
   if(q.calculation?.factor!==1)issue('unsupported-factor',[q.id],'Conversion is calculated from units; additional factors need explicit quantity operands.');
   if(q.range)issue('calculated-range',[q.id],'Calculated quantities use their cited operands, not an unrelated range.');
   try{
    const result=computedProjectQuantity(q,values);
    if(result===null||q.value===null||Math.abs(result-q.value)>Math.max(.000001,Math.abs(result)*.000001))issue('quantity-calculation',[q.id],'Written quantity must agree with a dimensionally valid calculation.');
    if(q.calculation?.inputIds.some(id=>quantities.get(id)?.basis==='allowance'||quantities.get(id)?.basis==='unknown'))issue('uncertain-calculation',[q.id],'An uncertain operand cannot become a confirmed calculated measurement.');
   }catch(error){if(error instanceof ProjectRecordError)issues.push(...error.problems);else throw error;}
  }else if(q.calculation!==null)issue('unexpected-calculation',[q.id],'Only calculated quantities may have a formula.');
 }
 return issues;
}

export function validateProjectRecord(proposal:ProjectProposal,input:ProjectInput):RecordProblem[]{
 const issues:RecordProblem[]=[];
 const issue=(code:string,ids:string[],message:string)=>issues.push({code,ids,message});
 if(proposal.service==='unclassified'&&!proposal.questions.some(q=>q.kind==='scope'&&q.priority==='blocking'))issue('project-classification',[],'An unclear project purpose needs a specific scope question.');
 const collections=[proposal.evidence,proposal.subjects,proposal.requirements,proposal.questions];
 for(const collection of collections){const seen=new Set<string>();for(const item of collection){if(seen.has(item.id))issue('duplicate-id',[item.id],'IDs must be unique within their record type.');seen.add(item.id);}}
 const sources=new Map(input.sources.map(s=>[s.id,s])),evidence=new Map(proposal.evidence.map(e=>[e.id,e]));
 const subjects=new Set(proposal.subjects.map(s=>s.id)),quantities=new Map(proposal.quantities.map(q=>[q.id,q])),requirements=new Map(proposal.requirements.map(r=>[r.id,r]));
 const checkEvidence=(ids:string[],owner:string)=>{for(const id of ids)if(!evidence.has(id))issue('unknown-evidence',[owner,id],'Referenced evidence does not exist.');};
 for(const e of proposal.evidence){
  const source=sources.get(e.sourceId);
  if(!source||!normalized(source.text).includes(normalized(e.quote)))issue('unsupported-quote',[e.id,e.sourceId],'Evidence must quote its identified source verbatim. '+quotationFeedback(e.quote,source?.text));
  if(source?.status==='unreadable')issue('unreadable-evidence',[e.id],'Unreadable content cannot establish a confirmed fact.');
 }
 for(const subject of proposal.subjects){
  if(subject.parentId&&!subjects.has(subject.parentId))issue('unknown-subject',[subject.id,subject.parentId],'Parent subject does not exist.');
  checkEvidence(subject.evidenceIds,subject.id);
 }
 for(const cycle of graphCycles(new Map(proposal.subjects.map(s=>[s.id,s.parentId?[s.parentId]:[]]))))issue('subject-cycle',cycle,'Physical subjects cannot contain themselves through a parent relationship.');
 for(const q of proposal.quantities)if(!subjects.has(q.subjectId))issue('unknown-subject',[q.id,q.subjectId],'Quantity subject does not exist.');
 issues.push(...validateProjectQuantities(proposal.quantities,proposal.evidence));
 for(const r of proposal.requirements){
  if(!subjects.has(r.subjectId))issue('unknown-subject',[r.id,r.subjectId],'Requirement subject does not exist.');
  checkEvidence(r.evidenceIds,r.id);
  if(r.quantityId&&!quantities.has(r.quantityId))issue('unknown-quantity',[r.id,r.quantityId],'Requirement quantity does not exist.');
  if(r.quantityId&&quantities.has(r.quantityId)&&quantities.get(r.quantityId)!.subjectId!==r.subjectId)issue('quantity-subject',[r.id,r.quantityId],'A requirement must use a quantity of its own physical subject.');
  if(r.status==='included'&&r.responsibility==='contractor'&&r.quantityId&&quantities.get(r.quantityId)?.basis==='unknown'&&!proposal.questions.some(q=>q.priority==='blocking'&&(q.requirementIds.includes(r.id)||q.quantityIds.includes(r.quantityId!))))issue('unresolved-work',[r.id],'A genuinely unknown physical scope quantity needs a specific blocking question. Supporting production effort is derived separately during costing.');
  if(r.status==='existing'&&r.operation!=='retain')issue('existing-work',[r.id],'Existing conditions must be retained observations; proposed operations need an included requirement.');
  if(r.status==='included'&&r.responsibility==='unassigned'&&!proposal.questions.some(q=>q.priority==='blocking'&&q.requirementIds.includes(r.id)&&['responsibility','scope','conflict'].includes(q.kind)))issue('unknown-responsibility',[r.id],'Included work needs an explicit responsibility or a linked blocking question.');
  if(r.status==='conditional'&&!proposal.questions.some(q=>q.priority==='blocking'&&q.requirementIds.includes(r.id)))issue('unresolved-condition',[r.id],'Conditional work needs a linked blocking question so it cannot disappear from the estimate.');
  if(r.origin==='requested'&&!r.evidenceIds.length)issue('unattributed-work',[r.id],'Requested work must cite the customer or document evidence.');
  if(r.origin==='dependency'&&!r.requiredBy.length)issue('unsupported-dependency',[r.id],`Requirement ${r.id}: origin dependency requires nonempty requiredBy containing the included parent requirement IDs. If a source directly requests this work, use origin requested and cite that evidence.`);
  if(r.origin==='dependency'&&!r.reason.trim())issue('unsupported-dependency',[r.id],`Requirement ${r.id}: origin dependency requires a nonempty reason explaining the actual condition that makes this supporting work necessary.`);
  for(const parentId of r.requiredBy){const parent=requirements.get(parentId);if(!parent||parent.id===r.id||r.status==='included'&&parent.status!=='included')issue('invalid-dependency',[r.id,parentId],'Required work must reference a distinct included parent.');}
 }
 for(const cycle of graphCycles(new Map(proposal.requirements.map(r=>[r.id,r.requiredBy]))))issue('dependency-cycle',cycle,'Work dependencies contain a cycle.');
 for(const q of proposal.questions){
  if(!q.requirementIds.length&&!q.quantityIds.length&&q.kind!=='scope'&&q.kind!=='unreadable-source')issue('unlinked-question',[q.id],'A question must identify the work or quantity it resolves.');
  for(const id of q.requirementIds)if(!requirements.has(id)||requirements.get(id)?.status==='excluded'||requirements.get(id)?.status==='existing')issue('unrelated-question',[q.id,id],'A question cannot concern absent, excluded or retained work.');
  for(const id of q.quantityIds)if(!quantities.has(id))issue('unknown-quantity',[q.id,id],'Question quantity does not exist.');
  if(q.kind==='quantity'&&q.quantityIds.length&&q.quantityIds.every(id=>['stated','calculated'].includes(quantities.get(id)?.basis||'')))issue('redundant-question',[q.id],'Do not ask again for quantities already supported by the current record.');
 }
 for(const source of input.sources){
  const reviews=proposal.sourceReviews.filter(r=>r.sourceId===source.id);
  if(reviews.length!==1)issue('source-coverage',[source.id],'Every source needs exactly one review record.');
  if(source.status!=='read'&&reviews[0]?.status==='reviewed')issue('source-status',[source.id],'An incomplete source cannot be certified as fully read.');
 }
 for(const review of proposal.sourceReviews){
  if(!sources.has(review.sourceId))issue('unknown-source',[review.sourceId],'Source review references an unknown input.');
  if(review.status==='resolved-by-customer'){
   for(const id of review.resolutionEvidenceIds){
    const entry=evidence.get(id),source=entry&&sources.get(entry.sourceId);
    if(!source||!['customer-clarification','customer-revision'].includes(source.kind))issue('unsupported-source-resolution',[review.sourceId,id],'Source uncertainty can only be resolved by cited current customer clarification or revision evidence.');
   }
  }else if(review.status!=='reviewed'&&(!review.reason.trim()||!proposal.questions.some(q=>q.priority==='blocking'&&q.kind===(review.status==='conflicting'?'conflict':'unreadable-source'))))issue('unresolved-source',[review.sourceId],'A conflicting or unreadable source needs an explanation and a blocking clarification.');
 }
 for(const message of input.documentIssues)issue('document-coverage',[],message);
 return issues;
}

export function acceptProjectRecord(raw:unknown,input:ProjectInput,previous:ProjectRecord|null=null,now=new Date()):ProjectRecord{
 const proposal=projectProposalSchema.parse(raw),problems=validateProjectRecord(proposal,input);
 if(problems.length)throw new ProjectRecordError(problems);
 const recordHash=projectHash({version:PROJECT_RECORD_VERSION,sourceHash:input.sourceHash,proposal});
 if(previous?.recordHash===recordHash)return previous;
 return {...proposal,version:PROJECT_RECORD_VERSION,sourceHash:input.sourceHash,recordHash,revision:(previous?.revision||0)+1,sources:structuredClone(input.sources),createdAt:now.toISOString()};
}
export function projectRecordQuestions(record:ProjectRecord):ProjectQuestion[]{
 return [...record.questions].sort((a,b)=>Number(a.priority!=='blocking')-Number(b.priority!=='blocking'));
}
export function projectRecordIntegrity(record:ProjectRecord):boolean{
 const {version,sourceHash,recordHash,revision:_revision,sources,createdAt:_createdAt,...proposal}=record;void _revision;void _createdAt;
 return version===PROJECT_RECORD_VERSION
  &&sourceHash===projectHash(sources)
  &&recordHash===projectHash({version,sourceHash,proposal});
}
export function projectRecordChange(previous:ProjectRecord,next:ProjectRecord){
 const before=new Map(previous.requirements.map(r=>[r.id,projectHash(r)])),after=new Map(next.requirements.map(r=>[r.id,projectHash(r)]));
 return {fromRevision:previous.revision,toRevision:next.revision,added:[...after.keys()].filter(id=>!before.has(id)),removed:[...before.keys()].filter(id=>!after.has(id)),changed:[...after.keys()].filter(id=>before.has(id)&&before.get(id)!==after.get(id)),pricesInvalidated:previous.recordHash!==next.recordHash};
}
