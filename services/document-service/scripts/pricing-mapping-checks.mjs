/** Independent checks for the runner's fixed synthetic, owner-supplied scope. */
export function pricingMappingChecks(result,cabinet=false){
 const lines=result?.internal?.lines||[],expected=cabinet?20:100;
 const lf=unit=>['lf','linft','linearfoot','linearfeet'].includes(String(unit||'').toLowerCase().replace(/[^a-z]/g,''));
 const scope=cabinet?/\bcabinet/i:/\bbase\s*(?:board|moulding|molding)\b/i;
 return [
  {name:'Only requested installation labor is charged',pass:lines.length>0&&lines.every(l=>l.category==='field-labor'&&scope.test(l.description||''))},
  {name:'Exact source length retained without duplicate quantities',expected,pass:lines.length>0&&lines.every(l=>lf(l.unit)&&Number.isFinite(l.quantity)&&l.quantity>0)&&Math.abs(lines.reduce((n,l)=>n+l.quantity,0)-expected)<1e-9},
  {name:'Approved saved rates used',pass:lines.length>0&&lines.every(l=>l.evidence?.basis==='owner-estimating-schedule')},
  {name:'Building and floor retained',pass:lines.length>0&&lines.every(l=>/\balpha\b/i.test(l.building||'')&&/^(?:first(?:\s+floor)?|1st(?:\s+floor)?|1|main(?:\s+(?:floor|level))?)$/i.test(String(l.floor||'').trim()))},
  {name:'Direct-cost arithmetic matches quantity times unit cost',pass:lines.length>0&&lines.every(l=>Number.isFinite(l.unitCost)&&l.unitCost>0&&Number.isFinite(l.cost)&&Math.abs(l.cost-l.quantity*l.unitCost)<.011)}
 ];
}
