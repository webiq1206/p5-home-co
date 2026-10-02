/** Explicit synthetic estimates are saved for on-screen/PDF verification but
 * never automatically sent to customers, staff or CRM. This is not a spam or
 * lead-quality classifier, and never reclassifies an already sent receipt. */
export function suppressSyntheticEstimateNotifications(record:any):boolean{
 return [record?.contact?.name,record?.customer?.issue?.projectName,record?.scope?.answers?.projectName]
  .some(value=>typeof value==='string'&&/^(?:\[QA\](?:\s|$)|SYNTHETIC\s+QA\b)/i.test(value.trim()));
}
