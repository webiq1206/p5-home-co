import { compareIdentity, contractorFields, ContractorStoreError, type ContractorFields, type Identity } from "./identity.ts";

export type ImportIdentity = Identity & {id:number};
type PlanCandidate = { index:number; outcome:"new_candidate"|"existing_candidate"|"needs_review"; proposed:ContractorFields; candidates:{id:number;company:string;match:"exact"|"review"}[]; repeatedRows:number[] };
type InvalidCandidate = {index:number;outcome:"invalid";reason:string};
export function planContractorImport(candidates: readonly ImportIdentity[], inputs: readonly unknown[]):(PlanCandidate|InvalidCandidate)[] {
  if (inputs.length < 1 || inputs.length > 1000) throw new ContractorStoreError("Import between 1 and 1,000 directory rows per batch.",400);
  const parsed=inputs.map((raw,index)=>{
    try { return {index,proposed:contractorFields(raw)}; }
    catch (error) {
      if (error instanceof ContractorStoreError) return {index,reason:error.message};
      throw error;
    }
  });
  return parsed.map((row)=>{
    if (!row.proposed) return {index:row.index,outcome:"invalid",reason:row.reason ?? "Invalid row."};
    const proposed=row.proposed;
    // A spreadsheet can describe capability but cannot set current qualification.
    proposed.capabilities=proposed.capabilities.map(c=>({...c,verified:false}));
    const reviewed=candidates.flatMap(c=>{
      const match=compareIdentity(proposed,c);
      return match==="none" ? [] : [{id:c.id,company:c.company,match}];
    }).sort((a,b)=>a.id-b.id);
    const repeatedRows=parsed.flatMap(other=>other.index!==row.index && other.proposed && compareIdentity(proposed,other.proposed)!=="none" ? [other.index] : []);
    const outcome=repeatedRows.length ? "needs_review" : reviewed.length===0 ? "new_candidate" : reviewed.length===1 && reviewed[0].match==="exact" ? "existing_candidate" : "needs_review";
    return {index:row.index,outcome,proposed,candidates:reviewed,repeatedRows};
  });
}
