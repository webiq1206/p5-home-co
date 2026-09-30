/** Customer vocabulary shared by scope review, estimates and PDFs. No prices. */
export const TRADE_CATEGORIES = [
  "General Conditions", "Plans & Engineering", "Permits", "Demolition",
  "Water Damage Mitigation", "Excavation", "Concrete", "Framing", "Roofing",
  "Siding", "Windows & Doors", "Plumbing", "Electrical", "Heating & Cooling",
  "Insulation", "Drywall", "Painting", "Cabinets", "Countertops", "Tile",
  "Flooring", "Trim & Finish Carpentry", "Appliances", "Landscaping",
  "Cleanup & Disposal", "Other Project Work",
] as const;
export type TradeCategory = typeof TRADE_CATEGORIES[number];
const patterns: [TradeCategory, RegExp][] = [
  ["Water Damage Mitigation", /mitigat|dehumidif|blower fan|water extraction/i],
  ["Demolition", /\bdemo(?:lition)?\b|tear.?out|tear.?off/i],
  ["Plans & Engineering", /engineer|architect|drawing|\bplans?\b/i],
  ["Permits", /permit|plan review fee|inspection fee/i],
  ["Cleanup & Disposal", /dumpster|disposal|haul.?off|cleanup|clean.?up|final clean/i],
  ["Excavation", /excavat|grading|backfill|trenching|site clearing|gravel base/i],
  ["Concrete", /concrete|rebar|formwork|epoxy|polyaspartic|tuxedo.*flake/i],
  ["Windows & Doors", /\b(?:window|door)(?:\s*\/\s*(?:window|door))?\s+(?:flashing|perimeter caulk)\b/i],
  ["Roofing", /\broof|shingle|flashing|gutter/i],
  ["Siding", /siding|stucco|exterior cladding/i],
  ["Painting", /\b(?:painting|repainting|refinishing)\b|\b(?:paint|prime|refinish)\s+(?:(?:the|existing|new|upper|lower|base|wall|kitchen|bathroom|all|interior|exterior)\s+){0,4}(?:walls?|ceilings?|cabinets?|doors?|trim|baseboards?|crown|mou?ldings?)\b/i],
  ["Trim & Finish Carpentry", /\bcrown\b|\bbaseboards?\b|\bmou?ldings?\b/i],
  ["Cabinets", /cabinet|vanit|built.?ins?|bookshelf/i],
  ["Windows & Doors", /window|\bdoors?\b|glazing/i],
  ["Plumbing", /plumb|faucet|toilet|water heater|sewer|septic|\bwell\b|\bp.?traps?\b|sink trap|trap assembl|hose bibb?s?|vacuum breaker|\bdrain|\bshower\s+(?:valve|trim)\b/i],
  ["Electrical", /electri|wiring|outlet|receptacle|\bgfci\b|breaker|circuit|lighting|\blights?\b|light fixture/i],
  ["Heating & Cooling", /\bhvac\b|\bfurnace\b|heat pump|mini.?split|\bduct(?:s|work)?\b|ventilation/i],
  ["Insulation", /insulat|rockwool|sound.control batts/i],
  ["Drywall", /drywall|sheetrock|mud,? tape|tape.*texture/i],
  ["Countertops", /countertop|bench top|butcher block|quartz|granite/i],
  ["Tile", /tile|backsplash|grout/i],
  ["Flooring", /flooring|carpet|\blvp\b|\blvt\b|hardwood floor/i],
  ["Trim & Finish Carpentry", /trim|baseboard|crown|finish carpentry|finish carpenter|shelv/i],
  ["Painting", /paint|primer|caulking|sealant|sandpaper/i],
  ["Framing", /framing|joist|stud|truss|sheath|blocking|beam/i],
  ["Appliances", /appliance|refrigerator|dishwasher|microwave|oven|cooktop/i],
  ["Landscaping", /landscap|irrigation|\bsod\b|fencing/i],
  ["General Conditions", /supervision|project manag|mobiliz|site protection|dust|portable|rental|equipment/i],
];
/** A suggested trade never changes quantity, rate, commercial status or cost type. */
export function suggestedTrade(description: string): TradeCategory {
  // Explicit exclusions describe what is NOT supplied and must not select its trade.
  const included = description.replace(/\b(?:no|without|exclud(?:e|es|ed|ing))\s+[^,;()\n]*/gi, ' ');
  // "...testing and cleanup" at the end of a repair is housekeeping, not the trade doing the work.
  const work = included.replace(/(?:,|\band\b|\bincluding\b|\bwith\b)\s+(?:(?:final|incidental|minor|small|routine)\s+)?(?:debris\s+)?clean.?up\b/gi, " ");
  // Catalog descriptions append broad section names in parentheses. "Cabinet
  // install labor only (... Cabinet Refacing, Refinishing & Install ...)" is
  // cabinet installation, not the refinishing trade named in that section.
  // The substrate under new flooring is context, not a separate concrete trade.
  // An inline qualifier must not hide the actual item after it. Live cabinet
  // revision: "painted shaker upper (wall) kitchen cabinets" was truncated at
  // "(wall)" and incorrectly presented as a separate Painting scope.
  let primary=work;
  while(/\([^()]*\)/.test(primary))primary=primary.replace(/\([^()]*\)/g,' ');
  const item=primary.replace(/\b(?:over|on)\s+(?:(?:an?|the)\s+)?(?:existing\s+)?concrete(?:\s+(?:slab|subfloor|floor))?\b/gi,' ');
  if(/^\s*(?:repair|resecure|reattach|refasten)\b[^.]{0,100}\b(?:window|door)\s+trim\b/i.test(item))return "Trim & Finish Carpentry";
  return patterns.find(([, pattern]) => pattern.test(item))?.[0] ?? patterns.find(([, pattern]) => pattern.test(work))?.[0] ?? patterns.find(([, pattern]) => pattern.test(included))?.[0] ?? "Other Project Work";
}
export function tradeForLine(line: { trade?: string; description: string }): TradeCategory {
  if (line.trade !== undefined) {
    if (!(TRADE_CATEGORIES as readonly string[]).includes(line.trade)) throw new Error("Choose a valid project trade category");
    return line.trade as TradeCategory;
  }
  return suggestedTrade(line.description);
}
/** A multi-step task can mention disposal or a substrate without belonging
 * to that trade. Display its summary beside its principal accepted price;
 * all supporting line items remain in their own categories, charged once. */
export function tradeForScopeTask(task:{id:string;description:string;existingLineIds?:string[]},lines:{id:string;category:string;low:number;high:number}[],rules:{id:string;scopeTaskId?:string}[]):TradeCategory{
 const ids=new Set([...(task.existingLineIds||[]),...rules.filter(r=>r.scopeTaskId===task.id).map(r=>r.id)]);
 const weights=new Map<TradeCategory,number>();
 for(const line of lines){
  if(!ids.has(line.id)||!TRADE_CATEGORIES.includes(line.category as TradeCategory)||line.low<0||line.high<=0||!Number.isFinite(line.low+line.high))continue;
  const category=line.category as TradeCategory;
  weights.set(category,(weights.get(category)||0)+line.low+line.high);
 }
 const suggested=suggestedTrade(task.description);
 return [...weights].sort((a,b)=>b[1]-a[1]||(a[0]===suggested?-1:b[0]===suggested?1:0))[0]?.[0]||suggested;
}
/** Largest-remainder presentation rounding preserves the displayed range total. */
export function apportionAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a,b) => a+b, 0);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isFinite(sum) || sum <= 0 || weights.some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid category allocation");
  const exact = weights.map(n => total*n/sum), rounded = exact.map(Math.floor);
  const order = exact.map((n,i) => ({i, fraction:n-rounded[i]})).sort((a,b) => b.fraction-a.fraction || a.i-b.i);
  for (let i=0, remainder=total-rounded.reduce((a,b)=>a+b,0); i<remainder; i++) rounded[order[i % order.length].i]++;
  return rounded;
}
