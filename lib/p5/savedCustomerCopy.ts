import {customerPresentation} from './customerProjection.ts';
import {scopeText,type ReviewedScope} from './scope.ts';

/** Rebuild text damaged by an older privacy projection from the same saved
 * estimate's original scope. Prices, issue date, identity and line items stay
 * exactly as issued. Never reprice or spread an internal record into a public
 * response. Missing provenance leaves the saved customer copy untouched. */
export function restoreSavedCustomerCopy(customer:any,internal:any):any{
 const scope=internal?.scope as ReviewedScope|undefined;
 if(!customer||!scope||typeof scope.text!=='string'||!scope.answers||typeof scope.answers!=='object')return customer;
 const summary=scopeText(scope);
 if(!/\b(?:labor|materials?)[ -]only\b/i.test(summary))return customer;
 const restored=customerPresentation({
  ...customer,summary,
  ...(Array.isArray(internal.assumptions)?{assumptions:internal.assumptions}:{}),
  ...(Array.isArray(internal.exclusions)?{exclusions:internal.exclusions}:{}),
  ...(scope.extraction?.instructions?{instructions:scope.extraction.instructions}:{}),
 });
 return {...customer,summary:restored.summary,assumptions:restored.assumptions,exclusions:restored.exclusions,...(restored.instructions?{instructions:restored.instructions}:{})};
}
