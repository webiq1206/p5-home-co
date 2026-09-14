import {query as siteQuery} from "../../app/lib/db.ts";
import {boundedStatement} from "./databaseTimeout.ts";
/** The site's pool with every P5 statement bounded in time. */
export async function query(statement:string,values:unknown[]=[]):Promise<Record<string,any>[]>{
  return boundedStatement(()=>siteQuery(statement,values) as Promise<Record<string,any>[]>,statement);
}
