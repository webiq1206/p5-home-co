import {draftCredentials,readDraft,DraftError} from './store.ts';
import {query} from './database.ts';
import {protectRequest,limitedBody,json,failed} from './http.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {intakeSite} from './intakePolicy.ts';
import {intakeContact,intakeUnresolved,snapshotRouting,emptyIntakeDetails,intakeDetails,intakeScopeReviewed} from './intakeContract.ts';
import {intakeStore,IntakeConflict} from './intakeStore.ts';
import {SCOPE_FIELDS} from './scope.ts';
import {kickDriver} from './estimateDriver.ts';

export async function getIntake(request:Request){try{
  protectRequest(request);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
  if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Project not found.',404);
  return json({receipt:await intakeStore(query).read(id)});
}catch(error){return failed(error);}}

export async function postIntake(request:Request){try{
  protectRequest(request,20);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
  if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Save your project before sending it.',404);
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,2048)));
  if(body.revision!==draft.revision||body.confirmed!==true)throw new DraftError('Review and confirm the latest project details before sending.',409);
  if(!intakeScopeReviewed(draft))throw new DraftError('Confirm the whole project type, supporting work and exclusions against the current description before sending.',409);
  const site=intakeSite(draft.brand);if(!site)throw new DraftError('Project intake is not configured.',503);
  let contact;try{contact=intakeContact({...draft.contact,preferredContact:draft.intake?.contact.preferredContact||'either'});}catch(error){throw new DraftError(error instanceof Error?error.message:'Check your contact details.');}
  if(!draft.text.trim()&&!draft.uploads.length&&!Object.values(draft.answers).some(v=>v?.trim()))throw new DraftError('Describe your project or add a supporting file.');
  const details=intakeDetails(draft.intake||emptyIntakeDetails()),routing=snapshotRouting(site,draft.answers,details);
  if(routing.handoff)throw new DraftError(`Continue with ${routing.teamName} to send this project. Your saved details and files are retained.`,409);
  const receipt=await intakeStore(query).save({schema:1,projectId:draft.intake?.projectId||`${site}:${id}`,originSite:draft.intake?.originSite||site,currentSite:site,draftId:id,revision:draft.revision,contextVersion:draft.intake?.version||0,
    contact,details,scope:{text:draft.text,answers:draft.answers,extraction:draft.extraction,uploads:draft.uploads},routing,
    unresolved:[...new Set([...routing.unresolved,...intakeUnresolved(draft,SCOPE_FIELDS)])]});
  kickDriver('intake-saved');
  return json(receipt);
}catch(error){return failed(error instanceof IntakeConflict?new DraftError(error.message,409):error);}}
