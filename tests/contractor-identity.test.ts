import assert from "node:assert/strict";
import { test } from "node:test";
import { companyKey, compareIdentity, contractorFields, phoneKey } from "../app/lib/contractors/identity.ts";
const row=(company:string,phone="",email="")=>({company,phone,email});
test("company normalization is exact without folding away legal suffixes",()=>{
  assert.equal(companyKey(" Acme & Sons, LLC "), "acmesonsllc");
  assert.notEqual(companyKey("Acme LLC"),companyKey("Acme Inc"));
  assert.equal(phoneKey("+1 (208) 555-0150 ext. 22"),"2085550150");
});
test("automatic match requires corroboration and no conflicting known detail",()=>{
  assert.equal(compareIdentity(row("Acme LLC","(208) 555-0150"),row("Acme, LLC","+1 208-555-0150")),"exact");
  assert.equal(compareIdentity(row("Acme LLC"),row("Acme, LLC")),"review");
  assert.equal(compareIdentity(row("Acme LLC","","shared@example.com"),row("Other","","shared@example.com")),"review");
  assert.equal(compareIdentity(row("Acme","2085550150","first@example.com"),row("Acme","2085550150","second@example.com")),"review");
  assert.equal(compareIdentity(row("Acme"),row("Other")),"none");
});
test("validates contact fields and does not combine unlike capabilities",()=>{
  const base={company:"  Cabinet Example LLC ",email:"SHOP@EXAMPLE.COM",capabilities:[
    {division:"17",trade:"Cabinet door fabrication",keywords:["custom cabinet doors"],verified:true},
    {division:"17",trade:"Cabinet installation",keywords:["cabinet installation"],verified:false}
  ]};
  const normalized=contractorFields(base);
  assert.equal(normalized.company,"Cabinet Example LLC");
  assert.equal(normalized.email,"shop@example.com");
  assert.equal(normalized.capabilities.length,2);
  assert.throws(()=>contractorFields({...base,email:"bad@example.com?bcc=a@x.net"}),/valid email/);
  assert.throws(()=>contractorFields({...base,phone:"javascript:alert(1)"}),/valid phone/);
  assert.throws(()=>contractorFields({...base,capabilities:[base.capabilities[0],base.capabilities[0]]}),/Repeated/);
});
