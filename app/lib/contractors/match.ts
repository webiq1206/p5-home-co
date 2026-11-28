/** Conservative, explainable ranking. A division label by itself never qualifies a contractor. */
export type Capability = { division: string; trade: string; keywords: string[]; verified: boolean };
export type Candidate = {
  id: number; company: string; contact?: string | null; phone?: string | null; email?: string | null;
  serviceArea?: string | null; capabilities: Capability[]; history?: unknown; pricingNotes?: string | null;
  active?: boolean; onHold?: boolean; qualified?: boolean; availability?: "available" | "unavailable" | "unknown";
  performance?: "positive" | "negative" | "unknown";
  completedSimilarJobs?: number;
};
export type Task = { id: string; division: string; title: string; description?: string; costCode?: string | null;
  bucket?: string; performer?: string; dismissed?: boolean; area?: string | null };
type Role = "supply" | "install";
const WORDS: Record<string,string> = {
  cabinetry:"cabinet", cabinets:"cabinet", doors:"door", vanities:"vanity", countertops:"countertop",
  installations:"install", installation:"install", installing:"install", installed:"install",
  replacement:"replace", replacing:"replace", fabrication:"fabricate", fabricated:"fabricate",
  fabricate:"fabricate", supplier:"supply", supplies:"supply", supplying:"supply", supply:"supply",
  subcontractor:"", contractor:"", contracting:"", services:"", service:"", work:"",
};
const STOP = new Set(["and","or","a","an","the","of","in","for","with","finish","custom","new","existing","provide","scope","general","labor","material","materials"]);
const normalized = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
const words = (s: string) => normalized(s).split(/\s+/).map(w => WORDS[w] ?? w).filter(w=>w&&!STOP.has(w));
const roles = (s:string): Role[] => {
  const w=words(s);
  const out:Role[]=[];
  if(w.some(x=>x==="supply"||x==="fabricate"||x==="manufacture")) out.push("supply");
  if(w.includes("install")) out.push("install");
  return out;
};
const TV = new Set(["boise","meridian","eagle","kuna","star","middleton","nampa","caldwell","garden city"]);
const CITY = [...TV].sort((a,b)=>b.length-a.length);
const ADA = new Set(["boise","meridian","eagle","kuna","star","garden city"]);
const CANYON = new Set(["nampa","caldwell","middleton"]);
function hasPhrase(hay:string, phrase:string){return ` ${hay} `.includes(` ${phrase} `);}
export function projectLocality(address: string | null | undefined, jurisdiction?: string|null) {
  if (jurisdiction) {
    const j=normalized(jurisdiction).replace(/^city of /,"");
    if(CITY.includes(j)) return j;
  }
  const a=normalized(address??"");
  // Match only the end of the postal locality, never a city appearing inside a street name.
  for(const city of CITY) if(new RegExp(`(?:^| )${city}(?: (?:id|idaho))?(?: \\d{5}(?: \\d{4})?)?$`).test(a)) return city;
  return null;
}
function geography(serviceArea:string|null|undefined, city:string|null){
  if(!city||!serviceArea) return null;
  const area=normalized(serviceArea);
  if(hasPhrase(area,city)) return {score:30,reason:`Lists ${city.replace(/\b\w/g,x=>x.toUpperCase())} in its service area`};
  if((TV.has(city)&&hasPhrase(area,"treasure valley"))||(ADA.has(city)&&hasPhrase(area,"ada county"))||(CANYON.has(city)&&hasPhrase(area,"canyon county"))) return {score:22,reason:"Documented regional service area covers the project"};
  return null;
}
const GENERIC = new Set(["cabinet","construction","remodel","remodeling","repair","maintenance","handyman","building","design"]);
function fit(capability:Capability, task:Task){
  if (!capability.verified || capability.division !== task.division) return null;
  const target = `${task.title} ${task.description??""}`;
  const t = words(target);
  const required = roles(target);
  const verifiedText = [capability.trade,...capability.keywords].join(" ");
  const role = roles(verifiedText);
  const exactCode=!!task.costCode&&capability.keywords.some(x=>x.trim().toLowerCase()===task.costCode?.trim().toLowerCase());
  if(!exactCode && required.some(r=>!role.includes(r))) return null;
  if(!exactCode && task.performer==="supplier" && role.includes("install") && !role.includes("supply")) return null;
  if(!exactCode && task.performer==="subcontractor" && role.includes("supply") && !role.includes("install")) return null;
  let best=0;
  for(const k of [capability.trade,...capability.keywords]){
    if(!k.trim()||/^\d[\d-]*$/.test(k.trim())) continue;
    const w=words(k).filter(x=>x!=="supply"&&x!=="install"&&x!=="fabricate");
    if (!w.length || !w.every(x=>t.includes(x))) continue;
    // A vague label is insufficient regardless of a matching division or job history.
    if(w.length===1&&GENERIC.has(w[0])&&!(required.length&&roles(k).length)) continue;
    // Cabinet doors, vanities and countertops are distinct capability evidence, not substitutes.
    if(t.includes("cabinet")&&["door","vanity","countertop"].some(x=>t.includes(x)&&!w.includes(x)))continue;
    best=Math.max(best,35+Math.min(w.length,4)*5+(required.length?12:0));
  }
  if(exactCode)return {score:95,reason:`Verified for cost-book line ${task.costCode}`};
  return best ? {score:best,reason:`Verified work: ${capability.trade}`} : null;
}
export function rank<T extends Candidate>(task:Task, directory:T[], city:string|null) {
  if(task.performer==="internal" || task.dismissed) return [];
  const byId=new Map<number,{contractor:T;reason:string;score:number}>();
  for(const contractor of directory){
    if(contractor.active===false||contractor.qualified===false||contractor.onHold||contractor.availability==="unavailable")continue;
    if(!contractor.phone&&!contractor.email) continue;
    const area=geography(contractor.serviceArea,city);
    if(!area)continue;
    const best=contractor.capabilities.map(c=>fit(c,task)).filter((c):c is NonNullable<typeof c>=>Boolean(c)).sort((a,b)=>b.score-a.score)[0];
    if(!best)continue;
    let score=best.score+area.score;
    const reason=[best.reason,area.reason];
    const jobs=contractor.completedSimilarJobs;
    if(Number.isInteger(jobs)&&jobs!>0){score+=Math.min(jobs!,5)*2;reason.push("Documented similar project work");}
    if(contractor.availability==="available"){score+=5;reason.push("Availability confirmed");}
    if(contractor.performance==="positive"){score+=5;reason.push("Positive documented performance");}
    if(contractor.performance==="negative"){score-=10;reason.push("Performance concern recorded");}
    const item={contractor,reason:reason.join(". ")+".",score};
    if((byId.get(contractor.id)?.score??-1)<score) byId.set(contractor.id,item);
  }
  return [...byId.values()].sort((a,b)=>b.score-a.score||a.contractor.company.localeCompare(b.contractor.company)||a.contractor.id-b.contractor.id).slice(0,3);
}
