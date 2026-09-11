/** Expected continuation, not an incomplete customer estimate. */
export class PricingPending extends Error {
 readonly retryAfterMs:number;
 constructor(message='Pricing progress is saved. Continuing the scope check...',retryAfterMs=1500){super(message);this.name='PricingPending';this.retryAfterMs=retryAfterMs;}
}
