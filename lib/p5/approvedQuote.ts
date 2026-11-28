/**
 * Shared release quote contract. No provider, auth, customer email, or DB access.
 * Server adapters must resolve evidence and load an approved release before invoking it.
 * Draft or current customer payloads must never be used to construct the trust argument.
 */
export type BidClass =
  | "builder-cabinets" | "retail-cabinets" | "installed-cabinets" | "same-layout-kitchen"
  | "standard-remodel" | "complex-remodel" | "short-service" | "simple-addition"
  | "verified-conversion" | "protected";
export type ClassPolicy = {
  grossBps: number; normalNetBps: number; concessionGrossBps: number | null;
};
export type Release = {
  version: string; hash: string; hardFloorBps: number;
  classes: Readonly<Record<BidClass,ClassPolicy>>;
  // Adapters can resolve tier, remodel and component rates using the immutable catalog,
  // but every amount returned by this lookup must trace to the approved snapshot.
  rate: (code: string, contextKey: string) => { unit: string; cents: number } | null;
  // Stable verified book codes, not supplied by the untrusted quote request.
  services: Readonly<Record<Service,{code:string;costCode?:string;retailCents:number}>>;
};
type Service = "management" | "administration" | "accounting";
const SERVICES=["management","administration","accounting"] as const;
type Task = { id:string; groupId:string; code:string; contextKey:string; unit:string; milliQuantity:number; allowanceCents?:number };
type Group = { id:string; jobClass:BidClass; protectedSellCents?:number; minimumSellCents?:number; rush?:boolean };
export type QuoteInput = {
  groups: Group[];
  tasks: Task[];
  serviceHours: Record<Service,{milliHours:number;groupId:string;approvalRef:string}>;
  sharedCostCents: number;
  // Applies once to each sales dollar, including fixed-service dollars.
  salesCostBps: number;
};
type Checks = { scopeDefined:boolean; costsVerified:boolean; capacityOrRepeat:boolean; ownerReturnConfirmed:boolean; cashCovered:boolean; reason:string };
type TrustedGroup = {
  checks?: Checks;
  builder?: { steady:boolean; priorDistinctBooked:number; evidenceRef:string };
  privateConcession?: { netBps:number; actorId:string; approvalId:string; reason:string };
  bundledVisit?:boolean;
};
export type Trust = {
  audience:"public"|"internal";
  groups?: Readonly<Record<string,TrustedGroup>>;
  // Explicit server-approved fully loaded internal costs are needed to certify net.
  internalHourlyCostCents: Record<Service,number>;
};
type Row = {id:string;groupId:string;code:string;unit:string;milliQuantity:number;unitCostCents:number;costCents:number;allowanceCents:number;kind:"work"|"internal";saleCents:number;service?:Service;approvalRef?:string};
const must=(pass:unknown,message:string)=>{if(!pass)throw new Error(message);};
const cash=(n:number,max=1_000_000_000_000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const clean=(s:unknown)=>typeof s==="string"&&s.trim()!==""&&s.length<=160;
const rounds=(qty:number,cents:number)=>Number((BigInt(qty)*BigInt(cents)+BigInt(500))/BigInt(1000));
const sum=(nums:readonly number[])=>nums.reduce((a,b)=>a+b,0);
/** Allocate each cent once in stable input order. Group output order is sorted by id. */
function share(cents:number, weights:number[]){
  const base=sum(weights), B=BigInt(base||weights.length);
  const w=base?weights:weights.map(()=>1);
  let through=BigInt(0),previous=0;
  return w.map(weight=>{
    through+=BigInt(weight);
    const next=Number((BigInt(cents)*through+B/BigInt(2))/B);
    const part=next-previous;previous=next;return part;
  });
}
function wholeDollarFloor(dollarsCents:number,denomBps:number){
  must(denomBps>0,"The approved costs and margins leave no room for a quote.");
  const numerator=BigInt(dollarsCents)*BigInt(10000), denominator=BigInt(denomBps)*BigInt(100);
  return Number((numerator+denominator-BigInt(1))/denominator*BigInt(100));
}
function verified(c?:Checks){return !!(c?.scopeDefined&&c.costsVerified&&c.capacityOrRepeat&&c.ownerReturnConfirmed&&c.cashCovered&&clean(c.reason));}

export function priceApprovedScope(release:Release,input:QuoteInput,trust:Trust){
  must(clean(release.version)&&/^[a-f0-9]{64}$/i.test(release.hash)&&release.hardFloorBps===1500,"An approved, versioned release is required.");
  must(cash(input.salesCostBps,9999)&&cash(input.sharedCostCents),"Enter valid company costs.");
  must(input.groups.length>0&&input.groups.length<=50&&input.tasks.length>0&&input.tasks.length<=1500,"Enter a bounded, non-empty scope.");
  const groups=input.groups.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const ids=new Set(groups.map(g=>g.id));
  must(ids.size===groups.length&&groups.every(g=>clean(g.id)&&Object.hasOwn(release.classes,g.jobClass)),"Each pricing group needs a unique id and approved job class.");
  const used=new Set<string>(), rows:Row[]=[];
  for(const t of input.tasks){
    must(clean(t.id)&&!used.has(t.id)&&!t.id.startsWith("service:"),"Each scope item needs a unique id.");
    used.add(t.id);
    must(ids.has(t.groupId)&&clean(t.code)&&clean(t.contextKey)&&clean(t.unit)&&cash(t.milliQuantity,1_000_000_000)&&t.milliQuantity>0,"Each scope item requires a valid group, unit, and quantity.");
    must(!SERVICES.some(s=>release.services[s].code===t.code||release.services[s].costCode===t.code),"Internal services are priced separately and cannot be added again.");
    const rate=release.rate(t.code,t.contextKey);
    if(!rate||rate.unit!==t.unit||!cash(rate.cents,1_000_000_000))throw new Error("No approved rate and unit match scope item "+t.id+".");
    const allowance=t.allowanceCents??0;
    must(cash(allowance),"An allowance must be nonnegative cents.");
    rows.push({id:t.id,groupId:t.groupId,code:t.code,unit:t.unit,milliQuantity:t.milliQuantity,unitCostCents:rate.cents,
      costCents:rounds(t.milliQuantity,rate.cents)+allowance,allowanceCents:allowance,kind:"work",saleCents:0});
  }
  for(const s of SERVICES){
    const h=input.serviceHours[s], r=release.services[s], cost=trust.internalHourlyCostCents[s];
    must(h&&ids.has(h.groupId)&&clean(h.approvalRef)&&cash(h.milliHours,1_000_000_000),"Enter approved hours for each of the three internal services.");
    must(r&&clean(r.code)&&r.retailCents===12500&&cash(cost,1_000_000_000),"Check the approved $125 service rate and internal hourly cost basis.");
    rows.push({id:"service:"+s,groupId:h.groupId,code:r.code,unit:"hr",milliQuantity:h.milliHours,unitCostCents:cost,
      costCents:rounds(h.milliHours,cost),allowanceCents:0,kind:"internal",saleCents:rounds(h.milliHours,r.retailCents),service:s,approvalRef:h.approvalRef});
  }
  const perGroup=new Map(groups.map(g=>[g.id,rows.filter(row=>row.groupId===g.id)]));
  must(groups.every(g=>perGroup.get(g.id)?.some(r=>r.kind==="work")),"Every pricing group needs actual work.");
  const direct=groups.map(g=>sum(perGroup.get(g.id)!.map(r=>r.costCents)));
  must(cash(sum(direct)),"Quote costs exceed the supported amount.");
  const shared=share(input.sharedCostCents,direct);
  const result=groups.map((g,i)=>{
    const facts=trust.groups?.[g.id];
    const approval=facts?.privateConcession;
    const b=facts?.builder;
    const qualifies=!g.rush&&trust.audience==="internal"&&verified(facts?.checks)&&!!b&&clean(b.evidenceRef)&&
      (b.steady||(cash(b.priorDistinctBooked,1_000_000)&&b.priorDistinctBooked>=2));
    const applied=g.jobClass==="builder-cabinets"&&!qualifies?"retail-cabinets":g.jobClass;
    const p=release.classes[applied];
    must(cash(p.normalNetBps,9999)&&p.normalNetBps>=release.hardFloorBps&&cash(p.grossBps,9999),"Invalid approved job-class policy.");
    let net=p.normalNetBps, gross=p.grossBps;
    if(g.rush)net=Math.max(net,applied.endsWith("-cabinets")?3000:2500);
    if(approval){
      must(trust.audience==="internal"&&!g.rush&&p.concessionGrossBps!==null&&cash(p.concessionGrossBps,9999)&&
        verified(facts?.checks)&&clean(approval.actorId)&&clean(approval.approvalId)&&clean(approval.reason)&&
        cash(approval.netBps,9999)&&approval.netBps>=release.hardFloorBps&&approval.netBps<net&&
        (applied!=="short-service"||facts?.bundledVisit===true),"This private concession is not approved or does not meet the policy floor.");
      net=approval.netBps; gross=p.concessionGrossBps!;
    }
    const min=g.minimumSellCents??0, protectedSell=g.protectedSellCents??0;
    must(cash(min)&&cash(protectedSell),"Invalid protected sale or visit minimum.");
    // Unknown protected same-scope economics must not become a firm price.
    if(applied==="protected")must(protectedSell>0,"Confirm the approved same-scope price for protected work.");
    const lines=perGroup.get(g.id)!;
    const fixed=sum(lines.filter(r=>r.kind==="internal").map(r=>r.saleCents));
    const total=Math.max(
      wholeDollarFloor(direct[i]+shared[i],10000-input.salesCostBps-net),
      wholeDollarFloor(direct[i],10000-gross),min,protectedSell,fixed,
    );
    must(cash(total),"Quote total exceeds the supported amount.");
    const work=lines.filter(r=>r.kind==="work").sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    share(total-fixed,work.map(r=>r.costCents)).forEach((n,i)=>work[i].saleCents=n);
    return {groupId:g.id,jobClass:applied,netBps:net,grossBps:gross,directCents:direct[i],sharedCostCents:shared[i],
      salesCostBps:input.salesCostBps,saleCents:total,approval:approval??null};
  });
  return {pricingVersion:release.version,releaseHash:release.hash,lines:rows,groups:result,totalCents:sum(result.map(g=>g.saleCents))};
}
