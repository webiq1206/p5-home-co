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
  ["Roofing", /roof|shingle|flashing|gutter/i],
  ["Siding", /siding|stucco|exterior cladding/i],
  ["Windows & Doors", /window|\bdoors?\b|glazing/i],
  ["Plumbing", /plumb|faucet|toilet|water heater|sewer|septic|\bwell\b/i],
  ["Electrical", /electri|wiring|outlet|circuit|lighting|light fixture/i],
  ["Heating & Cooling", /hvac|furnace|heat pump|mini.?split|duct|ventilation/i],
  ["Insulation", /insulat|rockwool|sound.control batts/i],
  ["Drywall", /drywall|sheetrock|mud,? tape|tape.*texture/i],
  ["Countertops", /countertop|bench top|butcher block|quartz|granite/i],
  ["Cabinets", /cabinet|vanit|built.?ins?|bookshelf/i],
  ["Tile", /tile|backsplash|grout/i],
  ["Flooring", /flooring|carpet|\blvp\b|\blvt\b|hardwood floor/i],
  ["Painting", /paint|primer|caulking|sealant|sandpaper/i],
  ["Trim & Finish Carpentry", /trim|baseboard|crown|finish carpentry|shelv/i],
  ["Framing", /framing|joist|stud|truss|sheath|blocking|beam/i],
  ["Appliances", /appliance|refrigerator|dishwasher|microwave|oven|cooktop/i],
  ["Landscaping", /landscap|irrigation|\bsod\b|fencing/i],
  ["General Conditions", /supervision|project manag|mobiliz|site protection|dust|portable|rental|equipment/i],
];
/** A suggested trade never changes quantity, rate, commercial status or cost type. */
export function suggestedTrade(description: string): TradeCategory {
  return patterns.find(([, pattern]) => pattern.test(description))?.[0] ?? "Other Project Work";
}
export function tradeForLine(line: { trade?: string; description: string }): TradeCategory {
  if (line.trade !== undefined) {
    if (!(TRADE_CATEGORIES as readonly string[]).includes(line.trade)) throw new Error("Choose a valid project trade category");
    return line.trade as TradeCategory;
  }
  return suggestedTrade(line.description);
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
