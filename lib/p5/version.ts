/** Live estimator release identifier. */
export const ESTIMATOR_VERSION='2026-09-20.1';
export type EstimatorRelease={sha:string;tree:string;dirty:boolean;builtAt:string};
/** Build-time git identity, written by next.config. Empty strings when the build had no git metadata. */
export function estimatorRelease():EstimatorRelease{
  try{const value=JSON.parse(process.env.NEXT_PUBLIC_P5_RELEASE||'{}');return{sha:String(value.sha||''),tree:String(value.tree||''),dirty:value.dirty===true,builtAt:String(value.builtAt||'')};}
  catch{return{sha:'',tree:'',dirty:false,builtAt:''};}
}
