/** Expected continuation, not an incomplete customer estimate. */
export class PricingPending extends Error {
 constructor(public readonly message='Pricing progress is saved. Continuing the scope check...',public readonly retryAfterMs=1500){super(message);this.name='PricingPending';}
}
