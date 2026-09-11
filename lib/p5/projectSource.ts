import type {BrowserDraft} from './browserDraft';
import {SCOPE_FIELDS,type ScopeAnswers,type ScopeField} from './scope';
export interface ProjectSource {id:string;answers:ScopeAnswers;imageUrl?:string}
/** Carry a designer's selections without replacing later visitor corrections or other projects. */
export function mergeProjectSource(draft:BrowserDraft,source:ProjectSource):BrowserDraft{
  if(JSON.stringify(draft.projectSource)===JSON.stringify(source))return draft;
  const answers={...draft.answers};const conflicts=[...(draft.conflicts||[])];
  const previous=draft.projectSource?.id===source.id?draft.projectSource.answers:{};
  for(const field of new Set([...Object.keys(previous),...Object.keys(source.answers)]) as Set<ScopeField>){
    const incoming=source.answers[field]||'';const current=answers[field]||'';
    if(!current||current===previous[field]){if(incoming)answers[field]=incoming;else delete answers[field];}
    else if(incoming&&current!==incoming&&!conflicts.some(c=>c.field===field))conflicts.push({field,values:[current,incoming],explanation:`Your saved answer and updated design differ for ${SCOPE_FIELDS[field].label.toLowerCase()}. Which should we use?`});
  }
  return {...draft,answers,conflicts,projectSource:source,dirty:true,updatedAt:Date.now(),analyzedAnswers:undefined,step:0};
}
