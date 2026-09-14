/** A database statement that never answers would leave a visitor on an
 * endless progress state (the host showed "Connection terminated unexpectedly"
 * during a pricing pass). Every P5 statement is bounded so the request fails
 * honestly, the saved progress is kept, and the next attempt resumes. */
export const DB_STATEMENT_TIMEOUT_MS=Number(process.env.P5_DB_STATEMENT_TIMEOUT_MS||30_000);
export async function boundedStatement<T>(run:()=>Promise<T>,statement:string,timeoutMs=DB_STATEMENT_TIMEOUT_MS):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`database-timeout: ${statement.trim().slice(0,60)}`)),timeoutMs);});
  try{return await Promise.race([run(),timeout]);}
  finally{if(timer)clearTimeout(timer);}
}
