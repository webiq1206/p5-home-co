import {query} from './database.ts';
import {DraftError} from './store.ts';

const KEY='qa-no-provider-v1';
export const QA_PROVIDER_HOLD='This QA draft permits deterministic pricing only. No provider request was started.';
/** A permanent restriction, created before a new synthetic draft is returned.
 * It survives edits, revisions, retries and omitted client flags. */
export async function restrictQaProviders(id:string,revision:number){
 await query("INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO NOTHING",[id,KEY,JSON.stringify({providerCallsAllowed:0,createdRevision:revision})]);
}
export async function qaProvidersRestricted(id:string):Promise<boolean>{
 const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,KEY]);
 return !!row;
}
export async function assertQaProvidersAllowed(id:string){
 if(await qaProvidersRestricted(id))throw new DraftError(QA_PROVIDER_HOLD,422);
}
