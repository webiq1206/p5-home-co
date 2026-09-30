import {requireEstimatorAdmin} from './adminAuth.ts';
import {DraftError,readDraftById} from './store.ts';
import {protectRequest,limitedBody,json,failed} from './http.ts';
import {isPricingPending} from './pricingProgress.ts';
import {readProjectQualification,runProjectQualification} from './projectRecordWork.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {readProjectConversation,saveProjectChange} from './projectConversation.ts';

const idValue=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw new DraftError('A valid project ID is required.');return value;};
export async function getProjectQualification(request:Request){try{
 protectRequest(request);await requireEstimatorAdmin();
 const id=idValue(new URL(request.url).searchParams.get('id')),draft=await readDraftById(id);
 if(!draft||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Project not found.',404);
 return json({qualification:true,draftRevision:draft.revision,saved:await readProjectQualification(id)||null,changes:await readProjectConversation(id)});
 }catch(error){return failed(error);}}
export async function postProjectQualification(request:Request){try{
 protectRequest(request);await requireEstimatorAdmin();
 const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,16384)));
 const id=idValue(body.id);
 if(body.action==='answer'||body.action==='revise')return json({qualification:true,...await saveProjectChange(id,{requestId:body.requestId,revision:body.revision,recordHash:body.recordHash,kind:body.action==='answer'?'answer':'revision',questionId:body.questionId,response:body.response})});
 if(!Number.isSafeInteger(body.revision)||body.revision<1||!['interpret','price'].includes(body.phase))throw new DraftError('Choose the current project revision and review step.');
 return json({qualification:true,result:await runProjectQualification(id,body.revision,body.phase)});
 }catch(error){if(isPricingPending(error))return json({pending:true,message:error.message},202);return failed(error);}}
