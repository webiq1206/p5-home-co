/** Expected continuation, not an incomplete customer estimate. */
export class PricingPending extends Error {
 readonly retryAfterMs:number;
 constructor(message='Pricing progress is saved. Continuing the scope check...',retryAfterMs=1500){super(message);this.name='PricingPending';this.retryAfterMs=retryAfterMs;}
}
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
