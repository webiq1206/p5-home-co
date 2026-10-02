/** Live estimator release identifier. */
// Bumped whenever pricing rules change: saved prices are keyed on it, so an old result is not replayed
// under new rules (2026-09-22: a new-home price saved before the core-scope guard replayed as $154k).
export const ESTIMATOR_VERSION='2026-10-02.10';
export type EstimatorRelease={sha:string;tree:string;dirty:boolean;builtAt:string;sourceDigest:string;changedPaths:string[];trackedFiles:number;lockfileEvidence:unknown[]};
/** Build-time git identity, written by next.config. Empty strings when the build had no git metadata. */
export function estimatorRelease():EstimatorRelease{
  try{const value=JSON.parse(process.env.NEXT_PUBLIC_P5_RELEASE||'{}');return{sha:String(value.sha||''),tree:String(value.tree||''),dirty:value.dirty===true,builtAt:String(value.builtAt||''),sourceDigest:String(value.sourceDigest||''),changedPaths:Array.isArray(value.changedPaths)?value.changedPaths.filter((path:unknown)=>typeof path==='string'):[],trackedFiles:Number(value.trackedFiles)||0,lockfileEvidence:Array.isArray(value.lockfileEvidence)?value.lockfileEvidence:[]};}
  catch{return{sha:'',tree:'',dirty:false,builtAt:'',sourceDigest:'',changedPaths:[],trackedFiles:0,lockfileEvidence:[]};}
}
