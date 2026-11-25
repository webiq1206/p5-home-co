/** Generate the Quote Calculator money formulas from the published website engine. */
import {bidLimits,NET_POLICY_VERSION} from "../lib/p5/netPricingPolicy.ts";
const math={one:"1",add:(a:string,b:string)=>`(${a}+${b})`,subtract:(a:string,b:string)=>`(${a}-${b})`,divide:(a:string,b:string)=>`(${a}/${b})`};
const limits=bidLimits("D5","E5","F5","L5","K5",math);
const places='IF(I5="All fixed",2,0)';
const gross=`=IF(OR(A5="",B5=""),"",IFERROR(IF(VLOOKUP(C5,'Pricing Policy'!$A$4:$F$16,5,FALSE)="Yes",IF(G5>0,G5,""),IF(ISNUMBER(D5),ROUNDUP(${limits.gross},${places}),"")),""))`;
const net=`=IF(OR(A5="",B5=""),"",IF(OR(COUNT(D5:F5)<>3,D5<=0,MIN(E5:F5)<0,L5="",1-F5-L5<=0),"",ROUNDUP(${limits.net},${places})))`;
console.log(JSON.stringify({version:NET_POLICY_VERSION,gross,net}));
