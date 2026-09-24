/** Live estimator release identifier. */
// Bumped whenever pricing rules change: saved prices are keyed on it, so an old result is not replayed
// under new rules (2026-09-22: a new-home price saved before the core-scope guard replayed as $154k).
export const ESTIMATOR_VERSION='2026-09-24.2';
export type EstimatorRelease={sha:string;tree:string;dirty:boolean;builtAt:string};
/** Build-time git identity, written by next.config. Empty strings when the build had no git metadata. */
export function estimatorRelease():EstimatorRelease{
  try{const value=JSON.parse(process.env.NEXT_PUBLIC_P5_RELEASE||'{}');return{sha:String(value.sha||''),tree:String(value.tree||''),dirty:value.dirty===true,builtAt:String(value.builtAt||'')};}
  catch{return{sha:'',tree:'',dirty:false,builtAt:''};}
}
