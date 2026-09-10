import {referenceDirectCostBudget,type PriceReference} from "@/lib/p5/references";
export function P5ReferenceCostBudget({reference,overheadRate}:{reference:PriceReference;overheadRate:number|null}){
  if(overheadRate===null||!Number.isFinite(overheadRate)||overheadRate<0||overheadRate>=1)return null;
  if(reference.priceBasis!=="customer-price"||reference.commercialStatus!=="base"||reference.quantity<=0||reference.unitPrice<=0||reference.warnings.length)return <p>Resolve this item's price basis, scope or unit warnings before deriving a unit-cost budget.</p>;
  const money=(n:number)=>n.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
  return <section aria-label="Reference unit-cost budgets"><h4>Unit-cost budgets from this example</h4>
    <p>At the source selling price of {money(reference.unitPrice)} per {reference.unit} and {(overheadRate*100).toFixed(2)}% overhead recovery:</p>
    <dl style={{margin:0}}>{[.15,.20,.25,.30].filter(margin=>overheadRate+margin<1).map(margin=><div key={margin} style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:12,padding:"10px 0",borderBottom:"1px solid #89938c"}}><dt>{margin*100}% profit target</dt><dd style={{margin:0,fontWeight:600}}>{money(referenceDirectCostBudget(reference.unitPrice,overheadRate,margin,0).maximumDirectUnitCost)} per {reference.unit}</dd></div>)}</dl>
    <p>These are maximum direct-cost budgets including project contingency. They are not observed supplier or payroll costs. Match the quantities, specifications, project conditions and date before using the example. The selected service's profit rules still apply.</p>
  </section>;
}
