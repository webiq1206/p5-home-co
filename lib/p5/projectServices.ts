/**
 * Owner-authorized supplement to the master book. These are final customer
 * hourly prices, NOT direct costs. Do not feed them through a margin formula.
 * Kept browser-safe so the internal milestone editor uses the same rules.
 */
export const PROJECT_SERVICES_VERSION = "project-services-v2";
export const PROJECT_SERVICE_RATE = 125;
export const HISTORICAL_SERVICE_RATE = 120;
export const PROJECT_OVERHEAD_CREDIT_ID = "project-services-overhead-credit";
/** Documented annual owner salaries in the maintained unified-overhead policy.
 * No rent/advertising/profit is misclassified as owner labor. */
export function projectOverheadCredit(fees:number,ordinaryPrice:number,overheadRate:number,annualOverhead=420000,ownerSalaryOverheadAnnual=200000):number {
  if(![fees,ordinaryPrice,overheadRate,annualOverhead,ownerSalaryOverheadAnnual].every(Number.isFinite)||
    fees<0||ordinaryPrice<0||overheadRate<0||annualOverhead<=0||ownerSalaryOverheadAnnual<0||ownerSalaryOverheadAnnual>annualOverhead)
    throw new Error("Invalid project-service salary overlap budget.");
  return cents(Math.min(fees,ordinaryPrice*overheadRate*ownerSalaryOverheadAnnual/annualOverhead));
}
export const PROJECT_SERVICE_ROLES = [
  { code: "01-31-03", name: "Project management", minimum: .25, costFactor: .0005, qboItemId:"48" },
  { code: "01-31-04", name: "Project administration", minimum: .125, costFactor: .0002, qboItemId:"49" },
  { code: "01-31-05", name: "Project accounting", minimum: .125, costFactor: .0001, qboItemId:"47" },
] as const;
export const PROJECT_MILESTONES = ["planning", "delivery", "closeout"] as const;
export type ProjectServiceCode = typeof PROJECT_SERVICE_ROLES[number]["code"];
export type ProjectServiceItemId = typeof PROJECT_SERVICE_ROLES[number]["qboItemId"];
/** Shared admin policy. Rates and accounting identities are intentionally not editable. */
export type ProjectServiceDefaults = Record<ProjectServiceCode, {hoursPer1000:number;minimumHours:number}>;
export const DEFAULT_PROJECT_SERVICE_DEFAULTS:ProjectServiceDefaults=Object.freeze(Object.fromEntries(
  PROJECT_SERVICE_ROLES.map(r=>[r.code,Object.freeze({hoursPer1000:r.costFactor*1000,minimumHours:r.minimum})]),
)) as ProjectServiceDefaults;
export function validateProjectServiceDefaults(value:unknown):ProjectServiceDefaults {
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==PROJECT_SERVICE_ROLES.length)throw new Error("Provide defaults for exactly the three project-service roles.");
  const result={} as ProjectServiceDefaults;
  for(const {code} of PROJECT_SERVICE_ROLES){
    const row=(value as Record<string,unknown>)[code] as Record<string,unknown>|undefined;
    if(!row||typeof row!=="object"||Array.isArray(row)||
      Object.keys(row).length!==2||!Object.hasOwn(row,"hoursPer1000")||!Object.hasOwn(row,"minimumHours"))
      throw new Error(`Provide an hourly factor and whole-project minimum for ${code}.`);
    const {hoursPer1000,minimumHours}=row;
    if(typeof hoursPer1000!=="number"||!Number.isFinite(hoursPer1000)||hoursPer1000<=0||hoursPer1000>100000||
      typeof minimumHours!=="number"||!Number.isFinite(minimumHours)||minimumHours<=0||minimumHours>100000||
      Math.round(minimumHours*PROJECT_SERVICE_RATE*100)<=0)
      throw new Error("Hour factors and whole-project minimums must be finite, strictly positive and at most 100,000; minimum hours must produce a positive cent amount.");
    result[code]={hoursPer1000,minimumHours};
  }
  return result;
}
/** Absence means the original approved defaults, never an implicit policy upgrade. */
export function projectServiceDefaults(value?:unknown):ProjectServiceDefaults {
  return validateProjectServiceDefaults(value===undefined?DEFAULT_PROJECT_SERVICE_DEFAULTS:value);
}
/** A priced project has the complete set once, never a second per-scope fee set.
 * Legacy estimates without any service SKU retain their existing behavior. */
export function assertProjectServiceSet(lines:readonly {sku?:unknown}[]):void {
  const codes=lines.filter(l=>l.sku!==undefined).map(l=>typeof l.sku==="string"?projectServiceCode(l.sku.trim()):undefined);
  if(codes.length&&(codes.length!==3||PROJECT_SERVICE_ROLES.some(r=>codes.filter(c=>c===r.code).length!==1)))
    throw new Error("An estimate must contain each of the three project-service SKUs exactly once.");
}
/** P5 Home Co LLC service-item allowlist, not a client-controlled ItemRef.
 * Item hints are consistency checks only. Ordinary lines keep their existing
 * mapping; a service-item hint without its SKU must not become a default item. */
export function resolveProjectServiceLine(line:{
  sku?:unknown;qboItemId?:unknown;itemId?:unknown;quantity?:unknown;
  unit?:unknown;amount?:unknown;unitPrice?:unknown;
}){
  const hints=[line.qboItemId,line.itemId].filter(v=>v!==undefined);
  if(line.sku===undefined){
    if(hints.some(v=>PROJECT_SERVICE_ROLES.some(r=>r.qboItemId===String(v).trim())))
      throw new Error("Project-service item IDs require their approved SKU; no default item is allowed.");
    return null;
  }
  const sku=typeof line.sku==="string"?projectServiceCode(line.sku.trim()):undefined;
  const role=PROJECT_SERVICE_ROLES.find(r=>r.code===sku);
  if(!role)throw new Error("Unknown project-service SKU.");
  if(hints.some(v=>(typeof v!=="string"&&typeof v!=="number")||String(v).trim()!==role.qboItemId))
    throw new Error("Project-service item ID does not match the server-owned SKU mapping.");
  const number=(v:unknown)=>typeof v==="number"?v:typeof v==="string"&&v.trim()?Number(v):NaN;
  const quantity=number(line.quantity),amount=cents(number(line.amount));
  const unit=typeof line.unit==="string"?line.unit.trim().toUpperCase():"";
  const approvedRate=[PROJECT_SERVICE_RATE,HISTORICAL_SERVICE_RATE].find(rate=>cents(quantity*rate)===amount && (line.unitPrice===undefined||number(line.unitPrice)===rate));
  if(!["HR","HRS","HOUR","HOURS"].includes(unit)||!Number.isFinite(quantity)||quantity<=0||
    !Number.isFinite(amount)||amount<=0||approvedRate===undefined)
    throw new Error("Project-service lines require positive hours and the rate on the stored estimate.");
  return {sku:role.code,qboItemId:role.qboItemId,quantity,unit:"HR" as const,unitPrice:approvedRate,amount};
}
export type MilestoneHours = Record<typeof PROJECT_MILESTONES[number], number>;
export type ProjectServiceBasis = {outsideDirectCost:number;milestoneOutsideCosts?:MilestoneHours};
/** Money must already be outside direct costs, never a customer selling total.
 * Null detailed costs use the existing pre-owner direct-cost estimate. */
export function projectServiceCostBasis(rows:readonly {
  cost:number|null;tax?:number;excluded?:boolean;milestone?:string;
}[],preOwnerDirectCost=0):ProjectServiceBasis {
  if(!Number.isFinite(preOwnerDirectCost)||preOwnerDirectCost<0)throw new Error("Invalid pre-owner direct-cost estimate.");
  const outside=rows.filter(r=>!r.excluded);
  if(outside.some(r=>r.cost!==null&&(!Number.isFinite(r.cost)||r.cost<0)))throw new Error("Invalid outside direct cost.");
  const known=outside.every(r=>r.cost!==null&&Number.isFinite(r.cost)&&r.cost>=0);
  if(!known||!rows.length)return {outsideDirectCost:preOwnerDirectCost};
  const costs=outside.map(r=>{
    const tax=r.tax??0;
    if(!Number.isFinite(tax)||tax<0||tax>r.cost!)throw new Error("Invalid included tax in outside direct costs.");
    return {...r,net:r.cost!-tax};
  });
  const outsideDirectCost=cents(costs.reduce((n,r)=>n+r.net,0));
  const allocated=costs.length>0&&costs.every(r=>PROJECT_MILESTONES.includes(r.milestone as typeof PROJECT_MILESTONES[number]));
  return {outsideDirectCost,...(allocated?{milestoneOutsideCosts:Object.fromEntries(PROJECT_MILESTONES.map(m=>
    [m,cents(costs.filter(r=>r.milestone===m).reduce((n,r)=>n+r.net,0))])) as MilestoneHours}:{})};
}
export const projectServiceQboItem=(code:string)=>PROJECT_SERVICE_ROLES.find(r=>r.code===code)?.qboItemId;
type ServiceCostInput={
  id:string;category?:string;quantity:number;unitCost:number;
  allowance?:boolean;
  evidence?:{reference:string};landed?:{tax:number};
  ownerLaborTreatment?:string;supervisionProvider?:"owner"|"outside";milestone?:string;
};
export function duplicateOwnerServiceCost(line:ServiceCostInput,legacy=false):boolean {
  const codes=[line.id,...(line.evidence?.reference.match(/(?:PB-)?01-31-0[1-5]\b/g)??[])];
  if(legacy)return line.id===PROJECT_OVERHEAD_CREDIT_ID||Boolean(projectServiceCode(line.id))||
    PROJECT_SERVICE_ROLES.some(r=>(line.evidence?.reference??"").includes(r.code))||isSuperintendentCode(line.id)||
    /01-31-0[12]\b/.test(line.evidence?.reference??"");
  const outside=line.supervisionProvider==="outside"||line.supervisionProvider!=="owner"&&line.category==="subcontractors";
  return line.id===PROJECT_OVERHEAD_CREDIT_ID||codes.some(c=>Boolean(projectServiceCode(c)))||
    line.ownerLaborTreatment==="included-in-overhead"||!outside&&codes.some(isSuperintendentCode);
}
export function documentProjectServiceBasis(lines:readonly ServiceCostInput[],preOwnerDirectCost=0):ProjectServiceBasis {
  return projectServiceCostBasis(lines.map(l=>({
    cost:Number.isFinite(l.quantity)&&Number.isFinite(l.unitCost)?l.quantity*l.unitCost:null,
    tax:l.landed?l.quantity*l.landed.tax:0,
    excluded:duplicateOwnerServiceCost(l)||l.category==="owner-production"||l.supervisionProvider==="owner"||
      Boolean(l.allowance&&(isSuperintendentCode(l.id)||/01-31-0[12]\b/.test(l.evidence?.reference??"")))||
      ["overhead","profit","tax","taxes"].includes(l.category??""),
    milestone:l.milestone,
  })),preOwnerDirectCost);
}
export type ProjectServicePlan = {
  version: typeof PROJECT_SERVICES_VERSION | "project-services-v1";
  /** Frozen on creation. Missing snapshots retain the original defaults forever. */
  defaults?: ProjectServiceDefaults;
  /** Internal employee overrides only. Missing roles keep their estimated defaults. */
  hours?: Partial<Record<ProjectServiceCode, MilestoneHours>>;
  /** "none" (owner instruction 2026-11-24, t2013u/t2015u): internal labor is billed in full at
   * $125/hour on new estimates with no overhead credit. Plans saved without it keep their original credit, so
   * already-priced jobs never change. */
  overheadCredit?: "none";
  /** Frozen on new estimates. Historical plans predate this field. */
  hourlyRate?: 125;
};
/** True when a plan bills internal labor in full, with no salary-overlap credit. */
export const billsInternalLaborInFull=(plan?:ProjectServicePlan)=>plan?.overheadCredit==="none";
export const newProjectServices = (defaults?:ProjectServiceDefaults): ProjectServicePlan =>
  ({ version: PROJECT_SERVICES_VERSION,hourlyRate:PROJECT_SERVICE_RATE,overheadCredit:"none",...(defaults?{defaults:validateProjectServiceDefaults(defaults)}:{}) });
/** Editing a draft version never updates the existing estimate itself.
 * Legacy, sent, accepted and invoiced estimates remain locked. */
export function projectServiceHoursEditable(plan:ProjectServicePlan|undefined,estimate?:{
  unsent:boolean;signed:boolean;invoiced:boolean;
}|null):boolean {
  return plan?.version===PROJECT_SERVICES_VERSION&&(!estimate||estimate.unsent&&!estimate.signed&&!estimate.invoiced);
}
export const projectServiceCode = (value: string) =>
  PROJECT_SERVICE_ROLES.find(r => value.replace(/^PB-/, "") === r.code)?.code;
export const isSuperintendentCode = (value: string) => /(?:^|PB-)01-31-0[12](?:$|[^0-9])/.test(value);
const cents = (n: number) => Math.round(n * 100) / 100;
const hoursPrecision=(n:number)=>Math.round(n*1e9)/1e9;

export function validateProjectServices(value: ProjectServicePlan): ProjectServicePlan {
  if (!value || ![PROJECT_SERVICES_VERSION,"project-services-v1"].includes(value.version)) throw new Error("Unsupported project service hours version.");
  if(value.hourlyRate!==undefined && (value.hourlyRate!==PROJECT_SERVICE_RATE || value.version==="project-services-v1")) throw new Error("Unsupported project-service rate.");
  if(value.defaults!==undefined){
    if(value.version==="project-services-v1")throw new Error("Historical project-service defaults cannot be changed.");
    validateProjectServiceDefaults(value.defaults);
  }
  if (value.overheadCredit !== undefined && value.overheadCredit !== "none") throw new Error("Unsupported project service overhead credit policy.");
  if (value.hours && (typeof value.hours !== "object" || Array.isArray(value.hours))) throw new Error("Project service hours must be keyed by role.");
  for (const [code, hours] of Object.entries(value.hours ?? {})) {
    if (projectServiceCode(code)!==code) throw new Error("Unknown project service code.");
    if (!hours || Object.keys(hours).some(k => !PROJECT_MILESTONES.includes(k as typeof PROJECT_MILESTONES[number])))
      throw new Error("Unknown project service milestone.");
    const values = PROJECT_MILESTONES.map(m => hours[m]);
    if (values.some(n => !Number.isFinite(n) || n < 0 || n > 100000) || cents(values.reduce((a, b) => a + b, 0)*PROJECT_SERVICE_RATE) <= 0)
      throw new Error("Each project service needs positive billable total hours and finite nonnegative milestone hours.");
  }
  return structuredClone(value);
}

/** Aggregate the WHOLE project first; never call once per room/scope/building. */
export function projectServiceLines(plan: ProjectServicePlan, directCost: number, taskCount: number, milestoneOutsideCosts?:Partial<MilestoneHours>) {
  validateProjectServices(plan);
  if (!Number.isFinite(directCost) || directCost < 0 || !Number.isFinite(taskCount) || taskCount < 0)
    throw new Error("Project service hours require a finite project cost and task count.");
  const weights=PROJECT_MILESTONES.map(m=>milestoneOutsideCosts?.[m]??0);
  if(weights.some(n=>!Number.isFinite(n)||n<0))throw new Error("Invalid milestone outside costs.");
  const weightTotal=weights.reduce((n,v)=>n+v,0);
  const hourlyRate=plan.hourlyRate??HISTORICAL_SERVICE_RATE;
  const legacy=plan.version==="project-services-v1";
  const defaults=projectServiceDefaults(plan.defaults);
  return PROJECT_SERVICE_ROLES.map((role,index) => {
    const estimatedHours = legacy?Math.ceil(Math.max([1,.5,.25][index],directCost*[.0001,.00005,.000025][index],taskCount*[.25,.125,.0625][index])*4)/4:
      hoursPrecision(Math.max(defaults[role.code].minimumHours, directCost/1000 * defaults[role.code].hoursPer1000));
    const planning=legacy?cents(estimatedHours*.2):Math.min(estimatedHours,hoursPrecision(estimatedHours*(weightTotal?weights[0]/weightTotal:1/3)));
    const delivery=legacy?cents(estimatedHours*.6):Math.min(hoursPrecision(estimatedHours-planning),hoursPrecision(estimatedHours*(weightTotal?weights[1]/weightTotal:1/3)));
    const hours = plan.hours?.[role.code] ?? {planning,delivery,closeout:hoursPrecision(estimatedHours-planning-delivery)};
    const quantity = hoursPrecision(PROJECT_MILESTONES.reduce((n, m) => n + hours[m], 0));
    return {
      code: role.code, description: role.name, hours, quantity, unit: "HR",
      unitPrice: hourlyRate, price: cents(quantity * hourlyRate),
      estimated: !plan.hours?.[role.code],
      source: legacy?`${plan.version}; ${plan.hours?.[role.code]?"internally reviewed":"scope-scaled estimated"} hours; planning ${hours.planning}, delivery ${hours.delivery}, closeout ${hours.closeout}; final $${hourlyRate}/hour, no markup. Project-specific coordination only, not company overhead or separate superintendent labor.`:
        `${plan.version}; ${plan.hours?.[role.code] ? "internally reviewed" : `editable outside-cost planning assumption on $${directCost}; ${defaults[role.code].hoursPer1000} hours per $1,000, project minimum ${defaults[role.code].minimumHours}`} hours; planning ${hours.planning}, delivery ${hours.delivery}, closeout ${hours.closeout}; final $${hourlyRate}/hour, no markup. No task-count or per-milestone minimum.`,
    };
  });
}
