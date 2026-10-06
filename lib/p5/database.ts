import {query as siteQuery,transaction as siteTransaction} from "../../app/lib/db.ts";
import {boundedStatement} from "./databaseTimeout.ts";
import {AsyncLocalStorage} from 'node:async_hooks';
type Read=(statement:string,values?:unknown[])=>Promise<Record<string,unknown>[]>;
const scopedReads=new AsyncLocalStorage<Read>();
/** The site's pool with every P5 statement bounded in time. */
export async function query(statement:string,values:unknown[]=[]):Promise<Record<string,any>[]>{
  return boundedStatement(()=>(scopedReads.getStore()||siteQuery)(statement,values) as Promise<Record<string,any>[]>,statement);
}
/** A short QA write fence shares one connection with its existing store calls.
 * Ordinary transactions retain their original behavior. Never wrap network I/O. */
export async function scopedTransaction<T>(run:(read:typeof query)=>Promise<T>):Promise<T>{
  if(scopedReads.getStore())return run(query);
  return siteTransaction(client=>scopedReads.run(async(statement,values=[])=>(await client.query(statement,values)).rows,()=>run(query)));
}
/** One transaction on the site's pool, exposing the same bounded query shape. The pricing charge ledger requires it. */
export async function transaction<T>(run:(query:(statement:string,values?:unknown[])=>Promise<Record<string,any>[]>)=>Promise<T>):Promise<T>{
  return siteTransaction(client=>run(async(statement,values=[])=>(await client.query(statement,values as any[])).rows as Record<string,any>[]));
}
