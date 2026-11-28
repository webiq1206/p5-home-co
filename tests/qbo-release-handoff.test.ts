import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareEstimate } from "../app/lib/scopes/estimate.ts";
import { can } from "../app/lib/leads/permissions.ts";

const sent = {
  CustomerRef: { value: "42" },
  Line: [{
    DetailType: "SalesItemLineDetail", Description: "Project administration", Amount: 31.25,
    SalesItemLineDetail: { ItemRef: { value: "49" }, Qty: .25, UnitPrice: 125, TaxCodeRef: { value: "NON" } },
  }],
};

test("authoritative unsent estimate readback reconciles exact project, SKU, quantity, rate, tax and total", () => {
  const actual = { ...sent, TotalAmt: 31.25 };
  assert.deepEqual(compareEstimate(sent, actual), {changed:false,sentTotal:31.25,currentTotal:31.25,details:[]});
  const dirty = {
    CustomerRef: { value: "91" }, TotalAmt: 36.95,
    Line: sent.Line.map(line => ({
      ...line, SalesItemLineDetail: { ...line.SalesItemLineDetail, ItemRef: { value: "47" }, TaxCodeRef: { value: "TAX" } },
    })),
  };
  assert.match(compareEstimate(sent, dirty).details.join(" "), /customer or project/);
  assert.match(compareEstimate(sent, dirty).details.join(" "), /product or service/);
  assert.match(compareEstimate(sent, dirty).details.join(" "), /tax code/);
  assert.match(compareEstimate(sent, dirty).details.join(" "), /total differs/);
  assert.match(compareEstimate(sent, { ...sent, TotalAmt: undefined }).details.join(" "), /authoritative estimate total/);
});

test("old payloads without optional fields compare only the evidence they captured", () => {
  const old = { Line: [{DetailType:"SalesItemLineDetail",Description:"Work",Amount:100,SalesItemLineDetail:{Qty:1,UnitPrice:100}}] };
  assert.equal(compareEstimate(old, {Line:old.Line,TotalAmt:100}).changed,false);
  assert.equal(compareEstimate(old, {Line:old.Line,TotalAmt:95}).changed,true);
});

test("administrator permission and scopes-only denial guard the QBO provider before mutation", () => {
  assert.equal(can("administrator","manage_integrations"),true);
  for (const role of ["manager","lead_coordinator","sales_rep","project_manager"] as const) {
    assert.equal(can(role,"manage_integrations"),false);
  }
  const route = readFileSync(new URL("../app/api/scopes/[id]/estimate/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf('g.user.scopesOnly || !can(g.user.role, "manage_integrations")');
  assert.ok(guard >= 0 && guard < route.indexOf("await qboState()"));
  assert.ok(guard < route.indexOf("await getProject(id)"));
  assert.ok(guard < route.indexOf("await createOrReviseEstimate("));
  assert.doesNotMatch(route, /await (?:compute|commitDoc)\(/);
  assert.match(route, /version\.pricing/);
  assert.match(route, /linked\?\.IsProject !== true/);
  assert.match(route, /live\.EmailStatus !== "NotSet"/);
  assert.match(route, /live\.CustomerRef\?\.value !== latest\.qbo_project_id/);
});
