import type {ScopeAnswers,ScopeExtraction} from './scope';
/** An explicit current request wins over the Cabinet page's historical supply-only default. */
export function cabinetIntent(text:string,services:readonly string[]):'cabinet-install'|'cabinet-product'|undefined{
  if(!services.includes('cabinet-install')||!services.includes('cabinet-product')||!/\b(?:cabinets?|vanity)\b/i.test(text))return;
  const without=/\b(?:exclude|excluding|without|no)\s+(?:the\s+)?install(?:ation|ing)?\b|\bsupply\s+only\b|\bdo\s+not\s+install\b/i.test(text);
  const withInstall=/\b(?:supply|supplying)\s+and\s+install(?:ing|ation)?\b|\binclude\s+(?:the\s+)?installation\b|\bcabinets?\s+with\s+installation\b/i.test(text);
  if(without===withInstall)return;
  return withInstall?'cabinet-install':'cabinet-product';
}
export function applyCabinetIntent(text:string,services:readonly string[],answers:ScopeAnswers,extraction?:ScopeExtraction){
  const service=cabinetIntent(text,services);
  if(!service)return {answers,extraction};
  return {answers:{...answers,service},extraction:extraction?{...extraction,facts:[...extraction.facts.filter(f=>f.field!=='service'),{field:'service' as const,value:service,confidence:1,source:'typed scope',evidence:text.slice(0,4000),basis:'stated' as const}],conflicts:extraction.conflicts.filter(c=>c.field!=='service')}:undefined};
}
