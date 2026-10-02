/** Shared wording for the saved estimate's cost basis, not its input source. */
export function pricingBasisNotes(result:{lineItems?:{pricingStatus?:string}[]}){
 return result.lineItems?.some(line=>line.pricingStatus==='owner-planning-rate')
  ?['Owner planning rates provide the foundation for this preliminary range. They are not current supplier quotes; verify local availability, selections and trade pricing before a firm proposal.']:[];
}
