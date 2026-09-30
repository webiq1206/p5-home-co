import type {ReviewedScope} from './scope.ts';

export interface InventoryComponent {id:string;description:string;evidence:string;origin?:string;basis?:string}
const BUILDING_SERVICES=new Set(['new-construction','addition','adu']);
const GARAGE=/\bgarage\b/i;
const OUTDOOR=/\b(?:porch|patio|covered outdoor)\b/i;

/** Independently measured spaces need their own coverage obligation even if
 * the model grouped them into a single building task. Quantities come only
 * from the reviewed answers, never from a rate or model-generated task. */
export function measuredBuildingComponents(scope:ReviewedScope,tasks:InventoryComponent[]):InventoryComponent[]{
 if(!BUILDING_SERVICES.has(scope.answers.service||'')||scope.extraction?.instructions?.separateBuildings)return [];
 const source=[scope.text,scope.extraction?.sourceText].filter(Boolean).join('\n');
 const definitions=[
  {field:'garageSqft',pattern:GARAGE,other:OUTDOOR,name:'garage'},
  {field:'coveredOutdoorSqft',pattern:OUTDOOR,other:GARAGE,name:/\bporch\b/i.test(source)?'covered porch':'covered outdoor space'},
 ] as const;
 return definitions.flatMap(({field,pattern,other,name})=>{
  const quantity=Number(scope.answers[field]);
  if(!Number.isFinite(quantity)||quantity<=0)return [];
  // A broad house + garage + porch item cannot satisfy a space-specific
  // coverage obligation before it has any price components at all.
  const dedicated=tasks.some(task=>pattern.test(task.description)&&!other.test(task.description)
   &&!/\b(?:conditioned living|complete (?:house|home)|new home construction)\b/i.test(task.description));
  return dedicated?[]:[{id:`measured-${field}`,description:`Construct the separately measured ${quantity} SF ${name}`,evidence:`Reviewed ${field} = ${quantity} SF, additional to conditioned living area. Preserve the original specifications and exclusions.`,origin:'requested',basis:'Reviewed separate area'}];
 });
}

/** A house assembly cannot cover a separately measured exterior space just
 * because both appear in the same parent task. Product text excludes that
 * parent prefix before this check is called. */
export function incompatibleBuildingComponent(task:string,product:string):boolean{
 if(!/\bseparately measured\b/i.test(task))return false;
 const prefix=product.lastIndexOf(': ');if(prefix>=0)product=product.slice(prefix+2);
 if(GARAGE.test(task))return !GARAGE.test(product);
 if(OUTDOOR.test(task))return !OUTDOOR.test(product);
 return false;
}

/** Selected interior work does not authorize electrical device replacements
 * through the generic word "reconnects". Preserve any explicit electrical
 * operation, electrically connected appliance, or complete-building scope. */
export function unsupportedElectricalTask(scope:ReviewedScope,task:InventoryComponent):boolean{
 if(!/\b(?:electrical|outlets?|switch(?:es)?|receptacles?)\b/i.test(task.description))return false;
 if(!/\bnot a gut renovation\b/i.test([scope.text,scope.extraction?.sourceText].filter(Boolean).join('\n')))return false;
 const source=[scope.text,scope.extraction?.sourceText].filter(Boolean).join('\n');
 const affirmative=source.split(/(?<=[.!?])\s+|\n|;/).filter(part=>!/^\s*(?:no\b|exclude\w*\b|not\b)/i.test(part)).join('\n');
 return !/\b(?:electrical|wiring|outlets?|switch(?:es)?|receptacles?|circuits?|lighting|lights?|fans?|appliances?|dishwashers?|disposals?|HVAC|alarms?|detectors?)\b/i.test(affirmative);
}
