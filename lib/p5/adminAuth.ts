import {getSessionUser} from "../../app/lib/auth.ts";
import {DraftError} from "./store";
export async function requireEstimatorAdmin(){
  const user=await getSessionUser();
  if(!user||user.role!=="administrator")throw new DraftError("Administrator sign-in is required.",403);
  return {id:String(user.id),email:String(user.email||"").toLowerCase()};
}
