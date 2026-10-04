import {query} from './database.ts';
import {DraftError,QA_NO_PROVIDER_KEY} from './store.ts';

export const QA_PROVIDER_HOLD='This QA draft permits deterministic pricing only. No provider request was started.';
/** The permanent restriction is committed atomically with draft creation. */
export async function qaProvidersRestricted(id:string,read=query):Promise<boolean>{
 const [row]=await read('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,QA_NO_PROVIDER_KEY]);
 return !!row;
}
export async function assertQaProvidersAllowed(id:string){
 if(await qaProvidersRestricted(id))throw new DraftError(QA_PROVIDER_HOLD,422);
}
