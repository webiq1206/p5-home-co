import {archiveBrowserDraft,loadBrowserDraft,newBrowserDraft,persistBrowserDraft} from './browserDraft.ts';
import {SCOPE_TEXT_LIMIT} from './scope.ts';
/** Only customer statements become project facts. Old assistant prices are not source evidence. */
export function assistantScope(messages:readonly {role:string;content:string}[],unsent=''):string {
  const text=[...messages.filter(m=>m.role==='user').map(m=>m.content),unsent].filter(v=>v.trim()).join('\n\n');
  if(text.length>SCOPE_TEXT_LIMIT)throw new Error('Your conversation is longer than one description. Add it as a document in the estimator.');
  return text;
}
/** A chat starts its own project; existing drafts remain available in recovery. */
export function continueAssistantProject(messages:readonly {role:string;content:string}[],unsent='') {
  const text=assistantScope(messages,unsent);
  const previous=loadBrowserDraft('');
  if((previous.text.trim()||previous.revision||previous.uploads?.length||previous.pendingFiles?.length)&&!archiveBrowserDraft(previous))
    throw new Error('Your existing project could not be backed up. Keep this chat open and retry.');
  const next={...newBrowserDraft(''),text,dirty:true};
  if(!persistBrowserDraft(next))throw new Error('This browser could not save your project. Keep this chat open and copy your notes into the estimator.');
  return next;
}
