/** Expected continuation, not an incomplete customer estimate. */
export class PricingPending extends Error {
 readonly retryAfterMs:number;
 /** A fatal pending error ends the job now: retrying cannot help (for example, every configured provider refuses the request). */
 readonly fatal:boolean;
 constructor(message='Pricing progress is saved. Continuing the scope check...',retryAfterMs=1500,fatal=false){super(message);this.name='PricingPending';this.retryAfterMs=retryAfterMs;this.fatal=fatal;}
}
/** Rate limits and provider outages use the shared bounded backoff, including research. */
export const retryablePricingProviderError=(error:unknown)=>error instanceof Error&&/^pricing-provider-unavailable:(?:429|5\d\d)\b/.test(error.message);
export const RESEARCH_FAILURE_COOLDOWN_MS=15*60_000;
export const expiredResearchFailure=(reply:unknown,now=Date.now())=>Boolean(reply&&typeof reply==='object'&&typeof (reply as {researchFailedAt?:number}).researchFailedAt==='number'&&now-(reply as {researchFailedAt:number}).researchFailedAt>=RESEARCH_FAILURE_COOLDOWN_MS);
export const PRICING_UNAVAILABLE='Our pricing service is temporarily unavailable. Your project and contact details are saved, and we will follow up with your estimate by email.';
/** One pricing stage exceeded its own time allowance while the overall
 * deadline still stands. The caller may choose a bounded alternative. */
export class PricingStageTimeout extends Error {
 constructor(message='pricing-stage-timeout'){super(message);this.name='PricingStageTimeout';}
}
/** Name-based checks survive a class copy in another chunk. */
export function isPricingPending(error:unknown):error is PricingPending{
 return error instanceof PricingPending||(typeof error==='object'&&error!==null&&(error as {name?:unknown}).name==='PricingPending'&&typeof (error as {retryAfterMs?:unknown}).retryAfterMs==='number');
}
export function isPricingStageTimeout(error:unknown):error is PricingStageTimeout{
 return error instanceof PricingStageTimeout||(typeof error==='object'&&error!==null&&(error as {name?:unknown}).name==='PricingStageTimeout');
}
