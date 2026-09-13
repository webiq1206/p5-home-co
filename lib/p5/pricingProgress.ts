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
