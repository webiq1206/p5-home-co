import {query as siteQuery,transaction as siteTransaction} from "../../app/lib/db.ts";
import {boundedStatement} from "./databaseTimeout.ts";
/** The site's pool with every P5 statement bounded in time. */
export async function query(statement:string,values:unknown[]=[]):Promise<Record<string,any>[]>{
  return boundedStatement(()=>siteQuery(statement,values) as Promise<Record<string,any>[]>,statement);
}
/** One transaction on the site's pool, exposing the same bounded query shape. The pricing charge ledger requires it. */
export async function transaction<T>(run:(query:(statement:string,values?:unknown[])=>Promise<Record<string,any>[]>)=>Promise<T>):Promise<T>{
  return siteTransaction(client=>run(async(statement,values=[])=>(await client.query(statement,values as any[])).rows as Record<string,any>[]));
}
