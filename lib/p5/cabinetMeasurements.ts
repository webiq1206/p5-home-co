import type {ScopeField} from './scope.ts';

const assemblies:Partial<Record<ScopeField,string>>={
 cabinetBaseLf:'(?:(?:base|lower) cabinets?|vanit(?:y|ies)(?: cabinets?)?)',
 cabinetUpperLf:'(?:upper|wall) cabinets?',
 cabinetTallLf:'(?:(?:tall(?: pantry)?|pantry) cabinets?)',
};
const number='(\\d+(?:\\.\\d+)?)';
const inches='\\s*(?:["″]|[- ]?inch(?:es)?\\b|\\s+in\\.?(?=\\s|$))';
const counts:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
/** Accept only arithmetic grounded in an explicitly attributed cabinet width.
 * Heights, counts alone, room dimensions and estimates remain unconfirmed. */
export function verifiedCabinetWidth(field:ScopeField,value:string,evidence:string):boolean{
 const assembly=assemblies[field];
 if(!assembly||/\b(?:assum\w*|infer\w*|estimated|unknown|not (?:specified|measured|shown))\b/i.test(evidence))return false;
 const expected=Number(value.replaceAll(',',''));if(!Number.isFinite(expected)||expected<=0)return false;
 const same=(width:number,count=1)=>Math.abs(width*count/12-expected)<.005;
 const many=new RegExp('\\b(\\d+|'+Object.keys(counts).join('|')+')\\s+'+assembly+'s?\\s*[,;:]?\\s*(?:each\\s+|at\\s+)'+number+inches+'\\s*(?:wide|width)\\b','gi');
 const groups=[...evidence.matchAll(many)];
 if(groups.length)return groups.length===1&&same(Number(groups[0][2]),counts[groups[0][1].toLowerCase()]||Number(groups[0][1]));
 const sizedAssembly='(?:[- ]wide\\s+'+assembly+(field==='cabinetBaseLf'?'|\\s+vanit(?:y|ies)(?: cabinets?)?':'')+')';
 const sizedSet=new RegExp('\\b(\\d+|'+Object.keys(counts).join('|')+')\\s+'+number+inches+sizedAssembly+'s?\\b','gi');
 const sets=[...evidence.matchAll(sizedSet)];
 if(sets.length)return sets.length===1&&same(Number(sets[0][2]),counts[sets[0][1].toLowerCase()]||Number(sets[0][1]));
 // An explicitly plural set needs an attributed count, not one cabinet's width.
 if(/\beach\b/i.test(evidence))return false;
 const widths=[
  new RegExp('\\b'+assembly+"(?:'s)?\\s*(?:[:,-]\\s*|(?:is|measures?)\\s+)?"+number+inches+'\\s*(?:wide|width)\\b','gi'),
  new RegExp('\\b'+number+inches+'(?:[- ]wide)?\\s+'+assembly+'\\s+(?:width|wide)\\b','gi'),
  new RegExp('\\b'+number+inches+'[- ]wide\\s+'+assembly+'\\b','gi'),
 ];
 // A nominal vanity size is a cabinet width, as in a specified 48-inch vanity.
 if(field==='cabinetBaseLf')widths.push(new RegExp('\\b'+number+inches+'\\s+vanity\\b(?!\\s+(?:height|tall|deep|depth))','gi'));
 const matches=[...new Map(widths.flatMap(pattern=>[...evidence.matchAll(pattern)].map(match=>[match.index,Number(match[1])] as const))).values()];
 return matches.length===1&&same(matches[0]);
}
