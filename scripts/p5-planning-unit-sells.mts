/** Compile the specialist planning widgets' unit sell schedules with the bid engine.
 * Only selling prices go into the public widgets. Source costs stay in the internal book.
 */
import {PRICE_BOOK} from "../lib/p5/priceBookData.ts";
import {netQuotePrice,type JobClass} from "../lib/p5/netPricingPolicy.ts";

const book=new Map(PRICE_BOOK.map(row=>[row[0],row]));
function unit(code:string, tier:number, jobClass:JobClass) {
  const cost=book.get(code)?.[10+tier];
  if(typeof cost!=="number" || cost<=0) throw new Error("Missing approved book reference "+code);
  // Price one hundred units and divide by 100 to retain cents per unit.
  return netQuotePrice({jobClass,direct:cost*1.10*100,otherCostDollars:0,otherCostRate:.20}).price/100;
}
const general={
  newHome:["90-10-01","protected"], addition:["90-50-01","protected"], detached:["90-50-10","protected"],
  attached:["90-50-11","protected"], basement:["90-40-02","standard-remodel"], wholeHome:["90-40-01","complex-remodel"],
  kitchen:["90-20-02","same-layout-kitchen"], structuralKitchen:["90-20-02","complex-remodel"], bathroom:["90-30-02","standard-remodel"],
} as const;
const cabinet={
  kitchen:["12-32-01","12-32-02"], bathroom:["12-41-03"], laundry:["12-43-02","12-43-01"], pantry:["12-32-16"],
  mudroom:["12-42-01"], "home-office":["12-44-06"], entertainment:["12-44-02","12-32-02"], "built-ins":["12-44-02","12-32-02"],
};
const generalSells=Object.fromEntries(Object.entries(general).map(([key,[code,category]])=>[key,[0,1,2,3].map(tier=>unit(code,tier,category))]));
const cabinetSells=Object.fromEntries(Object.entries(cabinet).map(([key,pair])=>[key,[unit(pair[0],0,"installed-cabinets"),pair[1]?unit(pair[1],0,"installed-cabinets"):0]]));
console.log(JSON.stringify({general:generalSells,cabinet:cabinetSells}));
