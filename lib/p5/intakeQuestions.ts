import {interpretIntakeIntent} from './intakeIntent.ts';
import {scopeQuestions,type ScopeQuestion} from './adaptive.ts';
import {unaskedQuestions} from './questionBudget.ts';
import type {BrowserDraft} from './browserDraft.ts';
import {customerQuestionKey} from './customerAnswers.ts';
import {SCOPE_FIELDS} from './scope.ts';
import {reconcileQuestionMemory,currentQuestionEntries,questionTopic,type QuestionDraft} from './intakeQuestionMemory.ts';
import {scopeFingerprint} from './scopeReplacement.ts';

/** Reuse source-aware clarification; do not ask customers to supply internal pricing inputs. */
export function intakeQuestions(draft:Pick<BrowserDraft,'answers'|'extraction'|'conflicts'|'wizard'|'text'|'pendingReply'|'intake'|'uploads'|'analyzedUploads'> & Partial<Pick<BrowserDraft,'revision'>> & Pick<QuestionDraft,'transcript'>):ScopeQuestion[]{
  const memory=reconcileQuestionMemory(draft),latest=currentQuestionEntries(memory);
  const conflictKey=(question:ScopeQuestion)=>{
    const conflict=(draft.conflicts??draft.extraction?.conflicts??[]).find(c=>c.field===question.field&&new Set(c.values).size>1);
    return conflict?`${questionTopic(question,draft.answers)}:conflict:${scopeFingerprint(JSON.stringify([...new Set(conflict.values)].sort()))}`:undefined;
  };
  if(latest.has('intake-review'))return [];
  const questions=scopeQuestions(draft.answers,draft.extraction,(draft.conflicts??draft.extraction?.conflicts??[]),draft.wizard?.skipped||[],[],draft.text)
    .filter(q=>!['laborHours','projectMonths'].includes(q.field)&&(q.field!=='estimatingInstructions'||Boolean(q.instructionId)))
    .map(q=>q.field==='service'?{...q,reason:interpretIntakeIntent(draft.text||'').clarification||'Which best describes the whole project?',values:[...SCOPE_FIELDS.service.options],handoff:undefined}:q);
  const contextual:ScopeQuestion[]=[];
  if(draft.answers.service){
    if(!draft.answers.location?.trim()&&!draft.answers.address?.trim()&&!draft.wizard?.skipped.includes('location'))contextual.push({field:'location',label:SCOPE_FIELDS.location.label,reason:'Where is the project? A city or ZIP code is enough for now.'});
    if(!draft.answers.schedule?.trim()&&!draft.wizard?.skipped.includes('schedule'))contextual.push({field:'schedule',label:SCOPE_FIELDS.schedule.label,reason:'Do you have a preferred start date or deadline? It is fine if you do not know yet.'});
  }
  const ordered=[...questions.filter(q=>q.conflict||q.field==='service'),...contextual,...questions.filter(q=>!q.conflict&&q.field!=='service')];
  const unread=draft.uploads?.some(file=>!draft.analyzedUploads?.some(read=>read.sha256===file.sha256&&read.size===file.size));
  const seen=new Set<string>();
  const selected=ordered.flatMap(question=>{
    const topic=questionTopic(question,draft.answers);if(!topic)return [];
    const conflict=question.conflict&&(draft.conflicts||draft.extraction?.conflicts||[]).find(c=>c.field===question.field&&new Set(c.values).size>1);
    // Rewording or a new model run is not a new conflict. Bind the exception to
    // the actual competing values, name them, and allow an unknown answer.
    const key=conflict?`${topic}:conflict:${scopeFingerprint(JSON.stringify([...new Set(conflict.values)].sort()))}`:topic;
    if(latest.has(key)||seen.has(key))return [];
    if(unread&&topic!=='service')return []; // originals go to the team; do not ask for a re-transcription
    seen.add(key);
    return [{...question,semanticId:key,...(conflict?{reason:`Your saved sources disagree about ${question.label.toLowerCase()}: ${conflict.values.join(' / ')}. Which should the team use?`,detail:`${conflict.explanation} You can leave this for the team if you are not sure.`}:{})}];
  });
  const pending=draft.pendingReply?.id?latest.get(draft.pendingReply.id):undefined;
  // Resume the same saved card, including its wording, rather than generate a
  // second version. Answered/unknown/declined cards can never be resumed.
  const active=pending?.state==='asked'&&pending.question&&(!pending.question.conflict||conflictKey(pending.question)===pending.topic)?pending.question:undefined;
  return active?[active,...selected.filter(q=>customerQuestionKey(q)!==draft.pendingReply?.id)]:unaskedQuestions(selected,draft.transcript,[]);
}
