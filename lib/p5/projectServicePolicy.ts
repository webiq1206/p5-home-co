import {query} from "./database.ts";
import {projectServiceDefaults,type ProjectServiceDefaults} from "./projectServices.ts";

export type ProjectServicePolicyRow={configured:boolean;defaults:unknown};
/** Same existing admin policy, no schema initialization or separate settings store.
 * Injectable read supports isolated save/readback tests without a runtime DB. */
export async function loadProjectServiceDefaults(
  read:()=>Promise<ProjectServicePolicyRow|null>=async()=>{
    try{
      const [row]=await query("SELECT payload ? 'projectServiceDefaults' AS configured, payload->'projectServiceDefaults' AS defaults FROM p5_estimator_policy WHERE id='current'");
      if(!row)return null;
      if(typeof row.configured!=="boolean")throw new Error("Invalid shared project-service policy metadata.");
      return {configured:row.configured,defaults:row.defaults};
    }catch(error){
      if((error as {code?:string}).code==="42P01")return null;
      throw error;
    }
  },
):Promise<ProjectServiceDefaults>{
  const row=await read();
  return projectServiceDefaults(row?.configured?row.defaults:undefined);
}
