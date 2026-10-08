import {SCOPE_FIELDS,type ScopeField} from './scopeFields.ts';
import type {ScopeAnswers,ScopeExtraction,ScopeUpload,ScopeConflict} from './scope.ts';
import type {ScopeQuestion} from './adaptive.ts';
import {sameAnswer} from './adaptive.ts';
import {pageCovered} from './documentLedger.ts';
import {cabinetQuestionField,projectAreaQuestionField} from './atomicQuestions.ts';
import {scopeFingerprint} from './scopeReplacement.ts';

export type QuestionState='asked'|'answered'|'unknown'|'declined'|'review';
export interface QuestionMemoryEntry {id:string;topic:string;state:QuestionState;value:string;source:string;revision:number;order?:number;observation?:string;question?:ScopeQuestion}
export interface QuestionMemory {schema:1;entries:QuestionMemoryEntry[]}
type Message={id:string;role:string;text:string;kind?:string;label?:string};
export interface QuestionDraft {revision?:number;text?:string;answers:ScopeAnswers;extraction:ScopeExtraction|null;conflicts?:ScopeConflict[];uploads?:ScopeUpload[];analyzedUploads?:Array<{sha256:string;size:number}>;transcript?:Message[];wizard?:{skipped:ScopeField[];resolutions?:ScopeAnswers};intake?:{questionMemory?:QuestionMemory;desiredOutcome?:string;workContext?:string;budget?:string}}
const generic=new Set(['otherDetails','estimatingInstructions']);
const typedSource=(source:string)=>/^(?:typed scope|submitted scope|typed instructions|customer instructions|user instructions|user revision|user|customer)$/i.test(source.trim());
const fieldTopic=(field:string)=>field==='address'?'location':field;
const decisionTopics:Array<[string,RegExp]>=[
 ['occupancy',/\b(?:occup(?:ied|ancy)|vacant|vacate|move\s+out|moving\s+out|remain\s+(?:in|at)|stay\s+(?:in|at)|liv(?:e|ing)\s+(?:in|at))\b/i],
 ['hardware-disposition',/\b(?:hardware|handles?|knobs?|hinges?)\b.*\b(?:retain|keep|reus\w*|replace|original)\b|\b(?:retain|keep|reus\w*|replace|original)\b.*\b(?:hardware|handles?|knobs?|hinges?)\b/i],
 ['shed-inclusion',/\bshed\b.*\b(?:include|exclude|scope|project)\w*\b|\b(?:include|exclude)\w*\b.*\bshed\b/i],
 ['location',/\b(?:address|zip(?:\s+code)?|city|county|project location|where\s+(?:is|will))\b/i],
 ['schedule',/\b(?:start date|deadline|timeline|timing|schedule|when\s+(?:would|will|do|should)|preferred start)\b/i],
 ['budget',/\b(?:budget|spending limit|spend|afford)\b/i],
];
/** Only recognized decisions may be asked automatically. Unclassified model prose
 * goes to the human review, not a second differently-worded question. */
export function questionTopic(question:Pick<ScopeQuestion,'field'|'reason'>,answers:ScopeAnswers={}):string|null {
 const decision=decisionTopics.slice(0,3).find(([,pattern])=>pattern.test(question.reason))?.[0];
 if(decision)return decision;
 if(!generic.has(question.field))return fieldTopic(question.field);
 const topic=decisionTopics.find(([,pattern])=>pattern.test(question.reason))?.[0];
 if(topic)return topic;
 const field=cabinetQuestionField(question.reason)||projectAreaQuestionField(question.reason,answers);
 return field?fieldTopic(field):null;
}
export function answerState(text:string):QuestionState {
 if(/\b(?:prefer (?:not|rather not)|rather not|don['’]?t (?:want|wish) to|decline|won['’]?t (?:share|provide)|not sharing|skip(?: this)?)\b/i.test(text))return 'declined';
 if(/\b(?:not sure|unsure|unknown|don['’]?t know|do not know|not (?:decided|known|available|chosen|set)|undecided|no (?:address|date|timeline|budget)(?: yet)?|to be (?:decided|determined)|tbd)\b/i.test(text))return 'unknown';
 return 'answered';
}
function entry(topic:string,state:QuestionState,value:string,source:string,revision:number,order:number,question?:ScopeQuestion,observation?:string):QuestionMemoryEntry {
 // topic/source identify the decision and evidence; id identifies this occurrence.
 // A -> unknown -> A must retain both occurrences of A, even within one save revision.
 const id=scopeFingerprint(JSON.stringify([topic,state,value,source,revision,order]));
 return {id,topic,state,value:value.slice(0,1200),source,revision,order,...(question?{question}:{}),...(observation?{observation}:{})};
}
export function readQuestionMemory(raw:unknown):QuestionMemory {
 if(raw===undefined)return {schema:1,entries:[]};
 const m=raw as QuestionMemory;
 if(!m||m.schema!==1||!Array.isArray(m.entries)||m.entries.length>512)throw new Error('Question history could not be saved. Your existing project is retained.');
 const entries=m.entries.map(e=>{
  if(!e||!['asked','answered','unknown','declined','review'].includes(e.state)||!Number.isInteger(e.revision)||e.revision<0||['id','topic','value','source'].some(k=>typeof e[k as keyof QuestionMemoryEntry]!=='string')||e.id.length>120||e.topic.length>240||e.value.length>1200||e.source.length>1500)throw new Error('Question history is invalid. Your existing project is retained.');
  if(e.order!==undefined&&(!Number.isSafeInteger(e.order)||e.order<1)||e.observation!==undefined&&(typeof e.observation!=='string'||e.observation.length>1500))throw new Error('Question history is invalid. Your existing project is retained.');
  let question:ScopeQuestion|undefined;
  if(e.question){const q=e.question;
   if(!Object.hasOwn(SCOPE_FIELDS,q.field)||typeof q.reason!=='string'||q.reason.length>2000||typeof q.label!=='string'||q.label.length>200||q.values&&(!Array.isArray(q.values)||q.values.length>30||q.values.some(v=>typeof v!=='string'||v.length>500)))throw new Error('Saved question is invalid.');
   question={field:q.field,label:q.label,reason:q.reason,semanticId:e.topic,...(q.values?{values:q.values}:{}),...(q.instructionId?{instructionId:String(q.instructionId).slice(0,500)}:{}),...(q.conflict?{conflict:true}:{}),...(q.detail?{detail:String(q.detail).slice(0,2000)}:{})};
  }
  return {id:e.id,topic:e.topic,state:e.state,value:e.value,source:e.source,revision:e.revision,...(e.order!==undefined?{order:e.order}:{}),...(e.observation?{observation:e.observation}:{}),...(question?{question}:{})};
 });
 return {schema:1,entries};
}
export function mergeQuestionMemory(...memories:Array<QuestionMemory|undefined>):QuestionMemory {
 const retained=new Map<string,QuestionMemoryEntry>();
 for(const e of memories.flatMap(m=>m?.entries||[])){
  const prior=retained.get(e.id);if(!prior||e.revision>prior.revision)retained.set(e.id,e);
 }
 const entries=[...retained.values()].sort((a,b)=>a.revision-b.revision||(a.order||0)-(b.order||0));
 return readQuestionMemory({schema:1,entries});
}
const derived=(e:QuestionMemoryEntry)=>/^(?:extraction|summary):/.test(e.source);
/** Inference never resolves an explicit decision or another source's review warning.
 * Among explicit events, revision and local order determine the current answer. */
export function currentQuestionEntries(memory:QuestionMemory):Map<string,QuestionMemoryEntry>{
 const latest=new Map<string,QuestionMemoryEntry>();
 const rank=(e:QuestionMemoryEntry)=>e.state==='asked'?0:derived(e)?e.state==='review'?2:1:3;
 for(const e of mergeQuestionMemory(memory).entries){
  const prior=latest.get(e.topic);if(!prior||rank(e)>=rank(prior))latest.set(e.topic,e);
 }
 return latest;
}
const nextOrder=(memory:QuestionMemory)=>Math.max(0,...memory.entries.map((e,i)=>e.order||i+1))+1;
const observationKey=(e:QuestionMemoryEntry)=>e.observation||(/^(?:field|detail):/.test(e.source)?e.source.split(':').slice(0,2).join(':'):e.source.startsWith('description:')?'description':undefined);
function textTopics(text:string):string[] {
 const topics=decisionTopics.filter(([,pattern])=>pattern.test(text)).map(([topic])=>topic);
 if(/\b(?:in|near|located at|located in)\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/.test(text))topics.push('location');
 if(/\b(?:tomorrow|next week|next month|next year|this (?:spring|summer|fall|winter)|no deadline|flexible timing)\b/i.test(text))topics.push('schedule');
 if(/\b(?:in|at|near|outside|located (?:in|at))\s+(?:Boise|Meridian|Nampa|Eagle|Kuna|Caldwell|Star|Garden City|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?[, ]+(?:ID|Idaho))\b/i.test(text)||/\b\d{5}(?:-\d{4})?\b/.test(text)||/\b\d+\s+(?:[A-Za-z]+\s+){1,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|boulevard|blvd)\b/i.test(text))topics.push('location');
 if(/\b(?:start|finish|begin|complete|ready|by|before|after|in)\b.{0,35}\b(?:january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter|20\d\d|next (?:week|month|year))\b|\b(?:no rush|whenever|asap)\b/i.test(text))topics.push('schedule');
 if(/\b\d+(?:\.\d+)?\s*(?:x|×|by)\s*\d+(?:\.\d+)?\s*(?:feet|foot|ft|meters?|m)\b/i.test(text))topics.push('length','width','sqft');
 if(/\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft|square (?:feet|foot)|sf)\b/i.test(text))topics.push('sqft');
 if(/\b(?:materials?|quartz|granite|laminate|butcher block|porcelain|cedar|oak|maple|painted (?:wood|mdf))\b/i.test(text))topics.push('materials');
 return [...new Set(topics)];
}
/** This ledger records that information was supplied, not a claim that an AI
 * interpretation is true. Original text, files and corrections stay intact. */
export function reconcileQuestionMemory(draft:QuestionDraft):QuestionMemory {
 let memory=mergeQuestionMemory(draft.intake?.questionMemory);
 // Destination draft revisions restart after handoff; project decision time must not.
 const revision=Math.max(draft.revision||0,...memory.entries.map(e=>e.revision));
 const add=(topic:string,state:QuestionState,value:string,source:string,observation?:string)=>{
  const candidates=memory.entries.filter(e=>e.topic===topic);
  // Mutable fields can return to an earlier value. Immutable transcript/file
  // observations are mined only once, so autosave does not replay old history.
  const previous=observation?candidates.filter(e=>observationKey(e)===observation).at(-1):candidates.find(e=>e.source===source&&e.state===state&&e.value===value.slice(0,1200));
  if(previous&&previous.state===state&&previous.value===value.slice(0,1200)&&previous.source===source)return;
  memory=mergeQuestionMemory(memory,{schema:1,entries:[entry(topic,state,value,source,revision,nextOrder(memory),undefined,observation)]});
 };
 const inspect=(value:string,source:string,state?:QuestionState,observation?:string)=>{for(const topic of textTopics(value))add(topic,state||answerState(value),value,source,observation);};
 for(const [field,value] of Object.entries(draft.answers))if(value?.trim()){
  if(!generic.has(field))add(fieldTopic(field),answerState(value),value,`field:${field}:${scopeFingerprint(value)}`,`field:${field}`);
  if(SCOPE_FIELDS[field as ScopeField]?.kind==='text')inspect(value,`field:${field}:${scopeFingerprint(value)}`,undefined,`field:${field}`);
 }
 for(const field of draft.wizard?.skipped||[])if(!draft.answers[field]?.trim())add(fieldTopic(field),'unknown','Not sure yet',`skip:${field}`);
 // Ignore quoted questions when mining supplied prose; their following answers
 // are paired below using the same canonical identity as new questions.
 const text=draft.text||'';inspect(text.replace(/Question:[^\n]*\n/gi,''),`description:${scopeFingerprint(text)}`,undefined,'description');
 for(const value of [text,draft.answers.estimatingInstructions||'']){
  for(const pair of value.matchAll(/Question:\s*([^\n]+)\n(?:My answer|Answer):\s*([^\n]+)/gi)){
   const topic=questionTopic({field:'estimatingInstructions',reason:pair[1]},draft.answers);if(topic)add(topic,answerState(pair[2]),pair[2],`saved-answer:${scopeFingerprint(pair[0])}`);
  }
 }
 let pending:Message|undefined;
 for(const message of draft.transcript||[]){
  if(message.role==='assistant'){pending=message.kind==='question'?message:undefined;continue;}
  if(pending){const field=(Object.keys(SCOPE_FIELDS) as ScopeField[]).find(f=>SCOPE_FIELDS[f].label===pending!.label);const topic=questionTopic({field:field||'estimatingInstructions',reason:pending.text},draft.answers);if(topic)add(topic,answerState(message.text),message.text,`conversation:${pending.id}:${message.id}`);pending=undefined;}
  inspect(message.text,`conversation:${message.id}`);
 }
 const extractionStates=new Map<string,QuestionState>();
 const coverage=draft.extraction?.documentCoverage;
 for(const fact of draft.extraction?.facts||[]){
  const matches=(draft.uploads||[]).filter(f=>fact.source.includes(f.name));
  const exact=matches.length===1&&matches[0].status==='stored'&&Boolean(matches[0].sha256)&&draft.analyzedUploads?.some(f=>f.sha256===matches[0].sha256&&f.size===matches[0].size);
  const pages=coverage?.pages.filter(p=>fact.source.includes(p.source)||matches.some(f=>p.source===f.name))||[];
  const needsReview=fact.basis!=='stated'&&fact.basis!=='calculated'||!Number.isFinite(fact.confidence)||fact.confidence<.85||!exact&&!typedSource(fact.source)||Boolean(coverage&&(!coverage.complete||pages.some(p=>!pageCovered(p))));
  const source=`extraction:${scopeFingerprint(JSON.stringify([fact.source,fact.evidence,fact.basis,fact.confidence,matches.map(f=>[f.id,f.sha256,f.size]),Boolean(exact),coverage]))}`;
  const state=needsReview?'review':answerState(fact.value);
  if(!generic.has(fact.field)&&fact.value.trim())add(fieldTopic(fact.field),state,fact.value,source);
  inspect(fact.evidence,source,state);
  for(const topic of [fieldTopic(fact.field),...textTopics(fact.evidence)])if(extractionStates.get(topic)!=='review')extractionStates.set(topic,state);
 }
 if(draft.extraction?.summary){const summary=draft.extraction.summary;for(const topic of textTopics(summary))add(topic,extractionStates.get(topic)||'review',summary,`summary:${scopeFingerprint(JSON.stringify([summary,[...extractionStates]]))}`);}
 for(const field of ['desiredOutcome','workContext','budget'] as const){const value=draft.intake?.[field];if(value){add(field,answerState(value),value,`detail:${field}:${scopeFingerprint(value)}`,`detail:${field}`);inspect(value,`detail:${field}:${scopeFingerprint(value)}`,undefined,`detail:${field}`);}}
 for(const saved of memory.entries.filter(e=>e.question?.conflict&&e.state==='asked')){
  const field=saved.question!.field,value=draft.wizard?.resolutions?.[field];
  if(value&&draft.answers[field]&&sameAnswer(field,value,draft.answers[field]!))add(saved.topic,answerState(value),value,`resolution:${field}:${scopeFingerprint(value)}`,`resolution:${saved.topic}`);
 }
 return memory;
}
export function recordQuestion(memory:QuestionMemory,question:ScopeQuestion,state:QuestionState,value:string,revision:number):QuestionMemory {
 const topic=question.semanticId||questionTopic(question);if(!topic)return memory;
 const current=currentQuestionEntries(memory).get(topic);
 if(current?.state===state&&current.value===value.slice(0,1200))return memory;
 return mergeQuestionMemory(memory,{schema:1,entries:[entry(topic,state,value,`question:${topic}:${scopeFingerprint(value)}`,Math.max(revision,...memory.entries.map(e=>e.revision)),nextOrder(memory),state==='asked'?question:undefined)]});
}
export function questionHistoryNotes(memory?:QuestionMemory):string[]{
 const latest=currentQuestionEntries(memory||{schema:1,entries:[]});
 return [...latest.values()].filter(e=>e.state!=='answered').map(e=>`${e.question?.label||SCOPE_FIELDS[e.topic as ScopeField]?.label||e.topic}: ${e.state==='declined'?'visitor chose not to provide this':e.state==='unknown'?'not known yet':e.state==='asked'?'asked once; left for team review':'supplied information needs team review'}.`);
}
