import type {ReviewedScope} from './scope.ts';

/** A fully checked document already has an evidence-linked work inventory.
 * Reuse every item, including uncertain quantities. The independent pricing
 * audit still compares the final mapping against the original scope. */
export function retainedScopeInventory(scope:ReviewedScope){
  const extraction=scope.extraction;
  if(!extraction?.documentCoverage?.complete||!extraction.takeoffs?.length||extraction.reviewNotes.length)return null;
  const items=extraction.takeoffs;
  if(items.some(item=>item.supersedes.length||('duplicateOf' in item&&item.duplicateOf)||('alternativeGroup' in item&&item.alternativeGroup)||('aggregateOf' in item&&Array.isArray(item.aggregateOf)&&item.aggregateOf.length)))return null;
  if(items.some(item=>!item.id.trim()||!item.description.trim()||!item.evidence.trim()||!item.sources.length))return null;
  if(new Set(items.map(item=>item.id)).size!==items.length)return null;
  // Typed additions and selections may add work beyond the document ledger.
  // Keep the full inventory step when they are present rather than discarding it.
  if(scope.text.trim()||scope.answers.estimatingInstructions?.trim())return null;
  return {tasks:items.map(item=>({id:item.id,description:[item.building,item.floor,item.description].filter(Boolean).join(' / '),evidence:item.evidence})),issues:items.flatMap(item=>item.issues.map(issue=>`${item.description}: ${issue}`)),notes:[] as string[]};
}
