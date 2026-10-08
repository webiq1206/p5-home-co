import {mergeQuestionMemory} from './intakeQuestionMemory.ts';
import {intakeContact,intakeDetails,emptyIntakeDetails,type IntakeContext} from './intakeContract.ts';
import {intakeSite} from './intakePolicy.ts';
import {DraftError,type Draft} from './store.ts';

/** Identity and origin come from persisted server state, never the browser's submitted metadata. */
export function intakeDraftContext(id:string,brand:string,existing:Draft|null,raw:unknown,contact:Draft['contact']):IntakeContext {
  const site=intakeSite(brand);if(!site)throw new DraftError('This website is not configured for project intake.',503);
  const prior=existing?.intake;
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  try{
    const details=intakeDetails(raw===undefined?prior||emptyIntakeDetails():value);
    return {...details,questionMemory:mergeQuestionMemory(prior?.questionMemory,details.questionMemory),projectId:prior?.projectId||`${site}:${id}`,originSite:prior?.originSite||site,currentSite:site,
      version:existing?.revision||0,contact:intakeContact({...contact,preferredContact:value.preferredContact??(value.contact as Record<string,unknown>|undefined)?.preferredContact??prior?.contact.preferredContact??'either'},false)};
  }catch(error){throw new DraftError(error instanceof Error?error.message:'Project details are invalid.');}
}
