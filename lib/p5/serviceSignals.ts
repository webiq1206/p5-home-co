/**
 * Project types that need evidence before a reader may assert them.
 *
 * Live P5 Home Co (2026-09-25): a typed "supply and install 200 SF of luxury vinyl plank in one
 * bedroom" came back from the reader as service "re10", basis "stated", confidence 1, with the
 * flooring sentence as its evidence. Nothing in it mentioned an inspection, a sale or an RE-10, yet
 * the estimate was issued as an "RE-10 repair estimate" at one firm price under the RE-10 policy.
 * A repair, change-order or rush classification changes the pricing policy, so it is accepted from
 * a reader only when the customer's own words carry the signal; otherwise the type is asked or,
 * on a repair-only site, defaults to ordinary home repairs.
 */
export const SERVICE_SIGNALS:Record<string,RegExp>={
  re10:/\bRE-?\s?10\b|\binspect(?:ion|or|ions)\b|\bbuyer'?s?\b|\bseller'?s?\b|\breal[- ]estate\b|\brealtor\b|\bclosing\b|\baddendum\b|\bescrow\b|\bdue[- ]diligence\b|\bpurchase (?:agreement|contract)\b|\bunder contract\b|\brepair (?:request|list|agreement)\b/i,
  rush:/\brush(?:ed)?\b|\burgent(?:ly)?\b|\bemergenc(?:y|ies)\b|\basap\b|\bas soon as possible\b|\bexpedit\w*\b|\bpriority\b|\bsame[- ]day\b|\bimmediately\b|\bright away\b|\bdeadline\b|\bby (?:this|next) (?:week|weekend|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i,
  'change-order':/\bchange[- ]orders?\b|\b(?:change|addition|add(?:ing|ed)?|revision) to (?:the |our |my )?(?:existing|current|signed|original|ongoing|active) (?:contract|scope|proposal|estimate|project|job)\b|\balready (?:under contract|in progress|underway|started)\b|\bmid[- ]project\b|\bduring construction\b|\bwhile (?:you|the crew|they) (?:are|were) (?:here|on site|working)\b/i,
};
/** Services a repair-only site (Handyman) offers; a menu made only of these has one ordinary default. */
export const REPAIR_SERVICES=['handyman','re10','change-order','rush'] as const;
/** True unless the service is one that needs a signal and the text carries none. */
export function serviceEvidenceSupports(service:string|null|undefined,text:string|null|undefined):boolean{
  const signal=SERVICE_SIGNALS[String(service||'')];
  return !signal||signal.test(String(text||''));
}
/** Any signal in the text for a policy-changing service, or null. */
export function signalledService(text:string|null|undefined):string|null{
  for(const [service,signal] of Object.entries(SERVICE_SIGNALS))if(signal.test(String(text||'')))return service;
  return null;
}
/**
 * On a site whose whole menu is repair work, a plain repair request is home repairs: asking "what
 * work would you like estimated?" with the choices Home repairs / RE-10 / Change order / Rush only
 * makes the customer confirm the obvious (live Handyman baseboard, 2026-09-24 and 2026-09-25). The
 * question is still asked whenever the text carries an RE-10, rush or change-order signal, and on
 * a multi-trade site, where the type genuinely decides the work.
 */
export function impliedRepairService(text:string|null|undefined,services:readonly string[]):'handyman'|null{
  if(!services.includes('handyman'))return null;
  if(!services.every(service=>(REPAIR_SERVICES as readonly string[]).includes(service)))return null;
  if(signalledService(text))return null;
  return 'handyman';
}
