import assert from "node:assert/strict";
import { test } from "node:test";
import { planContractorImport } from "../app/lib/contractors/import-plan.ts";
test("imports only unique candidates and existing links require corroboration",()=>{
  const existing=[{id:17,company:"Existing, LLC",email:"dispatch@example.com",phone:""}];
  const result=planContractorImport(existing,[
    {company:"Existing LLC",email:"DISPATCH@example.com"},
    {company:"Other",email:"alt@example.com",capabilities:[{division:"17",trade:"Cabinet doors",keywords:["custom doors"],verified:true}]},
    {company:"Bad data",phone:"NOT A PHONE"},
    {company:"Repeated"},{company:"Repeated."},
  ]);
  assert.deepEqual(result.map(r=>r.outcome),["existing_candidate","new_candidate","invalid","needs_review","needs_review"]);
  assert.equal(result[1]?.outcome==="new_candidate" && result[1].proposed.capabilities[0]?.verified,false);
});
test("holds a same-name change and duplicate mirror contacts for manual review",()=>{
  const result=planContractorImport([
    {id:17,company:"Existing LLC",email:"dispatch@example.com",phone:""},
    {id:19,company:"Elsewhere LLC",email:"dispatch@example.com",phone:""},
  ],[
    {company:"Existing LLC",email:"dispatch@example.com"},
    {company:"Existing LLC",email:"new@example.com"},
  ]);
  assert.deepEqual(result.map(r=>r.outcome),["needs_review","needs_review"]);
});
test("accepts a complete 622-row batch; refuses over-limit import",()=>{
  const source=Array.from({length:622},(_,i)=>({company:"Synthetic Company "+i}));
  assert.equal(planContractorImport([],source).filter(row=>row.outcome==="new_candidate").length,622);
  assert.throws(()=>planContractorImport([],Array.from({length:1001},()=>null)),/1,000/);
});
