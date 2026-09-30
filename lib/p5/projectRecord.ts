import {createHash} from 'node:crypto';
import type {ReviewedScope} from './scope.ts';
import {unitKey,UNIT_REGISTRY} from './unitRates.ts';
import {PROJECT_RECORD_VERSION,projectProposalSchema,type ProjectProposal,type ProjectQuantity,type ProjectQuestion} from './projectRecordContracts.ts';

export interface ProjectSource {
 id:string;kind:'customer-text'|'reviewed-answer'|'document-transcript'|'reader-observation';
 name:string;fileId:string|null;page:number|null;text:string;sha256:string;
 status:'read'|'partial'|'unreadable';
}
export interface ProjectInput {sources:ProjectSource[];sourceHash:string;documentIssues:string[]}
export interface ProjectRecord extends ProjectProposal {
 version:typeof PROJECT_RECORD_VERSION;revision:number;sourceHash:string;recordHash:string;
 sources:ProjectSource[];createdAt:string;
}
export interface RecordProblem {code:string;ids:string[];message:string}
export class ProjectRecordError extends Error {
 readonly problems:RecordProblem[];
 constructor(problems:RecordProblem[]){super('Project record needs correction');this.name='ProjectRecordError';this.problems=problems;}
}
export const projectHash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
const unique=(values:string[])=>[...new Set(values)];

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
export function projectInput(scope:ReviewedScope):ProjectInput{
 const sources:ProjectSource[]=[],documentIssues:string[]=[];
 const add=(kind:ProjectSource['kind'],name:string,text:string,fileId:string|null=null,page:number|null=null,status:ProjectSource['status']='read')=>{
  if(!text.trim())return;
  for(const block of sourceBlocks(text)){
   const sha256=projectHash({kind,name,fileId,page,text:block.text,start:block.start});
   sources.push({id:'src-'+sha256.slice(0,20),kind,name,fileId,page,text:block.text,sha256,status});
  }
 };
 add('customer-text','Current customer scope',scope.text);
 for(const [field,value]of Object.entries(scope.answers).sort(([a],[b])=>a.localeCompare(b)))if(value?.trim())add('reviewed-answer','Reviewed answer: '+field,field+': '+value);
 const extraction=scope.extraction;
 if(extraction?.sourceText)add('document-transcript','Retained reader transcript; verify against page observations',extraction.sourceText);
 for(const upload of scope.uploads){
  const pages=(extraction?.documentCoverage?.pages||[]).filter(p=>p.source===upload.name);
  if(upload.status!=='stored'||!pages.length)documentIssues.push('No completed page inventory for '+upload.name);
  for(const page of pages){
   const takeoffs=(extraction?.takeoffs||[]).filter(t=>t.sources.some(s=>s.source===upload.name&&s.page===page.page));
   const facts=(extraction?.facts||[]).filter(f=>f.source===upload.name);
   add('reader-observation',`${upload.name}, page ${page.page}`,JSON.stringify({page,takeoffs,...(pages.length===1?{facts}:{})}),upload.id,page.page,page.status);
   if(page.status!=='read')documentIssues.push(`${upload.name}, page ${page.page}: ${page.status}; ${(page.notes||[]).join('; ')}`);
  }
 }
 if(scope.uploads.length&&(!extraction?.documentCoverage?.complete||extraction.documentCoverage.pages.length!==extraction.documentCoverage.expectedPages))documentIssues.push('Document page coverage is incomplete or inconsistent.');
 // Facts from a reader are observations, not fresh customer answers. Keep all
 // details even when a legacy field cannot represent several rooms or items.
 if(extraction)add('reader-observation','Reader facts and takeoffs',JSON.stringify({summary:extraction.summary,facts:extraction.facts,takeoffs:extraction.takeoffs||[],conflicts:extraction.conflicts,instructions:extraction.instructions||null,reviewNotes:extraction.reviewNotes}));
 return {sources,sourceHash:projectHash(sources),documentIssues:unique(documentIssues)};
}

const unitMeasure=(unit:string):{dimension:string;scale:number}|null=>{
 const key=unitKey(unit);
 const extra:Record<string,{dimension:string;scale:number}>={in:{dimension:'length',scale:1/12},inch:{dimension:'length',scale:1/12},inches:{dimension:'length',scale:1/12},ft:{dimension:'length',scale:1},m:{dimension:'length',scale:3.280839895013123},mm:{dimension:'length',scale:.003280839895013123}};
 if(extra[key])return extra[key];
 const entry=UNIT_REGISTRY[key];if(!entry)return null;
 const scales:Record<string,number>={sy:9,square:100,acre:43560,ton:2000,cy:27,gallon:231/1728};
 // Count units retain identity. A pack is never an each without its contents.
 return {dimension:['count','time'].includes(entry.dimension)?entry.dimension+':'+key:entry.dimension,scale:scales[key]||1};
};
export function computedProjectQuantity(quantity:ProjectQuantity,quantities:ProjectQuantity[],visiting=new Set<string>()):number|null{
 if(visiting.has(quantity.id))throw new ProjectRecordError([{code:'quantity-cycle',ids:[quantity.id],message:'Quantity calculations contain a cycle.'}]);
 if(quantity.basis!=='calculated')return quantity.value;
 const expression=quantity.calculation;if(!expression)return null;
 const output=unitMeasure(quantity.unit);if(!output)return null;
 const seen=new Set(visiting).add(quantity.id);
 const inputs=expression.inputIds.map(id=>quantities.find(q=>q.id===id));
 if(inputs.some(q=>!q)||!inputs.length)return null;
 const measures=inputs.map(q=>unitMeasure(q!.unit));if(measures.some(m=>!m))return null;
 const values=inputs.map(q=>computedProjectQuantity(q!,quantities,seen));if(values.some(v=>v===null))return null;
 const normalizedValues=values.map((v,i)=>v!*measures[i]!.scale);
 let result:number;
 if(expression.operation==='sum'){
  if(measures.some(m=>m!.dimension!==output.dimension))return null;
  result=normalizedValues.reduce((a,b)=>a+b,0);
 }else if(expression.operation==='product'){
  if(inputs.length!==2||!measures.every(m=>m!.dimension==='length')||output.dimension!=='area')return null;
  result=normalizedValues[0]*normalizedValues[1];
 }else{
  if(inputs.length!==2||measures[0]!.dimension!==measures[1]!.dimension||output.dimension!=='count:each'||normalizedValues[1]===0)return null;
  result=normalizedValues[0]/normalizedValues[1];
 }
 return result*expression.factor/output.scale;
}

export function validateProjectRecord(proposal:ProjectProposal,input:ProjectInput):RecordProblem[]{
 const issues:RecordProblem[]=[];
 const issue=(code:string,ids:string[],message:string)=>issues.push({code,ids,message});
 const collections=[proposal.evidence,proposal.subjects,proposal.quantities,proposal.requirements,proposal.questions];
 for(const collection of collections){const seen=new Set<string>();for(const item of collection){if(seen.has(item.id))issue('duplicate-id',[item.id],'IDs must be unique within their record type.');seen.add(item.id);}}
 const sources=new Map(input.sources.map(s=>[s.id,s])),evidence=new Map(proposal.evidence.map(e=>[e.id,e]));
 const subjects=new Set(proposal.subjects.map(s=>s.id)),quantities=new Map(proposal.quantities.map(q=>[q.id,q])),requirements=new Map(proposal.requirements.map(r=>[r.id,r]));
 const checkEvidence=(ids:string[],owner:string)=>{for(const id of ids)if(!evidence.has(id))issue('unknown-evidence',[owner,id],'Referenced evidence does not exist.');};
 for(const e of proposal.evidence){
  const source=sources.get(e.sourceId);
  if(!source||!normalized(source.text).includes(normalized(e.quote)))issue('unsupported-quote',[e.id,e.sourceId],'Evidence must quote its identified source verbatim.');
  if(source?.status==='unreadable')issue('unreadable-evidence',[e.id],'Unreadable content cannot establish a confirmed fact.');
 }
 for(const subject of proposal.subjects){
  if(subject.parentId&&!subjects.has(subject.parentId))issue('unknown-subject',[subject.id,subject.parentId],'Parent subject does not exist.');
  checkEvidence(subject.evidenceIds,subject.id);
 }
 for(const q of proposal.quantities){
  if(!subjects.has(q.subjectId))issue('unknown-subject',[q.id,q.subjectId],'Quantity subject does not exist.');
  if(!unitMeasure(q.unit))issue('unsupported-unit',[q.id],'Quantity unit is not supported: '+q.unit);
  checkEvidence(q.evidenceIds,q.id);
  if(q.basis==='unknown'&&(q.value!==null||q.range!==null||q.calculation!==null))issue('invented-quantity',[q.id],'An unknown quantity cannot contain a measured value, range or calculation.');
  if(q.basis!=='unknown'&&(q.value===null||q.value<=0))issue('missing-quantity',[q.id],'A priced quantity must be positive.');
  if(q.basis==='stated'&&(!q.evidenceIds.length||q.range!==null||q.calculation!==null))issue('stated-evidence',[q.id],'Stated quantities require source evidence, without a modeled range or formula.');
  if(q.basis==='stated'&&q.value!==null){
   const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
   const quote=q.evidenceIds.map(id=>evidence.get(id)?.quote||'').join(' ').replace(/(\d),(?=\d{3}\b)/g,'$1').replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi,word=>String(words[word.toLowerCase()]));
   const values=[...quote.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(match=>Number(match[0]));
   if(!values.includes(q.value))issue('unstated-value',[q.id],'This numeric value is absent from its cited evidence; use a supported calculation or disclose an allowance.');
  }
  if(q.basis==='allowance'&&(!q.assumption.trim()||!q.range||q.range.low<=0||q.value===null||q.range.low>q.value||q.range.high<q.value||q.calculation!==null))issue('allowance-basis',[q.id],'An allowance needs a reason and positive range containing the budget quantity.');
  if(q.basis==='calculated'){
   if(q.calculation?.factor!==1)issue('unsupported-factor',[q.id],'Conversion is calculated from units; additional factors need explicit quantity operands.');
   if(q.range)issue('calculated-range',[q.id],'Calculated quantities use their cited operands, not an unrelated range.');
   try{
    const result=computedProjectQuantity(q,proposal.quantities);
    if(result===null||q.value===null||Math.abs(result-q.value)>Math.max(.000001,Math.abs(result)*.000001))issue('quantity-calculation',[q.id],'Written quantity must agree with a dimensionally valid calculation.');
    if(q.calculation?.inputIds.some(id=>quantities.get(id)?.basis==='allowance'||quantities.get(id)?.basis==='unknown'))issue('uncertain-calculation',[q.id],'An uncertain operand cannot become a confirmed calculated measurement.');
   }catch(error){if(error instanceof ProjectRecordError)issues.push(...error.problems);else throw error;}
  }else if(q.calculation!==null)issue('unexpected-calculation',[q.id],'Only calculated quantities may have a formula.');
 }
 for(const r of proposal.requirements){
  if(!subjects.has(r.subjectId))issue('unknown-subject',[r.id,r.subjectId],'Requirement subject does not exist.');
  checkEvidence(r.evidenceIds,r.id);
  if(r.quantityId&&!quantities.has(r.quantityId))issue('unknown-quantity',[r.id,r.quantityId],'Requirement quantity does not exist.');
  if(r.quantityId&&quantities.has(r.quantityId)&&quantities.get(r.quantityId)!.subjectId!==r.subjectId)issue('quantity-subject',[r.id,r.quantityId],'A requirement must use a quantity of its own physical subject.');
  if(r.status==='included'&&r.responsibility==='contractor'&&(!r.quantityId||quantities.get(r.quantityId)?.basis==='unknown')&&!proposal.questions.some(q=>q.priority==='blocking'&&(q.requirementIds.includes(r.id)||Boolean(r.quantityId&&q.quantityIds.includes(r.quantityId)))))issue('unresolved-work',[r.id],'Included work without a usable quantity needs a specific blocking question.');
  if(r.status==='existing'&&r.operation!=='retain')issue('existing-work',[r.id],'Existing conditions must be retained observations; proposed operations need an included requirement.');
  if(r.status==='included'&&r.responsibility==='unassigned')issue('unknown-responsibility',[r.id],'Included work needs an explicit responsibility or a question.');
  if(r.origin==='requested'&&!r.evidenceIds.length)issue('unattributed-work',[r.id],'Requested work must cite the customer or document evidence.');
  if(r.origin==='dependency'&&(!r.requiredBy.length||!r.reason.trim()))issue('unsupported-dependency',[r.id],'Supporting work must identify its parent work and why it is required.');
  for(const parentId of r.requiredBy){const parent=requirements.get(parentId);if(!parent||parent.id===r.id||r.status==='included'&&parent.status!=='included')issue('invalid-dependency',[r.id,parentId],'Required work must reference a distinct included parent.');}
 }
 const visit=(id:string,path:Set<string>)=>{if(path.has(id)){issue('dependency-cycle',[...path,id],'Work dependencies contain a cycle.');return;}const next=new Set(path).add(id);for(const parent of requirements.get(id)?.requiredBy||[])if(requirements.has(parent))visit(parent,next);};
 for(const r of proposal.requirements)visit(r.id,new Set());
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
 for(const review of proposal.sourceReviews)if(!sources.has(review.sourceId))issue('unknown-source',[review.sourceId],'Source review references an unknown input.');
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
