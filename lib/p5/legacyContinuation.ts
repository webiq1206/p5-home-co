/** Retired calculators must never issue a second price under an obsolete policy. */
export const estimatorContinuation = () => ({
  priceable: false,
  nextStep: '/estimate',
  message: 'Choose Continue project in this chat to carry your notes into the project estimator. Review the scope there to receive your estimate.',
});
export function retiredEstimatorResponse() {
  return Response.json({...estimatorContinuation(), message: 'This calculator has moved. Open /estimate and add your project details to receive an estimate.'}, {status:410,headers:{'cache-control':'no-store'}});
}

/** No generated monetary claim may escape a retired assistant pricing path. */
export function assistantReplyWithoutPrice(reply:string):string {
  return /\$\s*\d|\bUSD\s*\d|\d[\d,.]*\s*(?:dollars?|USD)\b/i.test(reply)
    ? 'Choose Continue project to carry your notes into the project estimator and review the scope for a current estimate.'
    : reply;
}
