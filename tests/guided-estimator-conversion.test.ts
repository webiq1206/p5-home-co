import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

// Execute the actual successful-response block without React, providers or HTTP.
const source = readFileSync(new URL("../components/estimator/GuidedEstimator.tsx", import.meta.url), "utf8");
const start = source.indexOf("if (json.ok && json.estimate) {");
const end = source.indexOf("} else if (json.errors?.length)", start);
assert.ok(start >= 0 && end > start);
const successBlock = `${source.slice(start, end)}}`;

function run(status: number, embedded: boolean) {
  const calls: string[] = [];
  vm.runInNewContext(successBlock, {
    json: { ok: true, estimate: {} }, response: { status }, embedded,
    setEstimate: () => calls.push("show-result"),
    report: (name: string) => calls.push(name),
    trackAcceptedInquiry: () => calls.push("Lead"),
    window: { scrollTo: () => calls.push("scroll") },
  });
  return calls;
}

test("new persisted estimate emits completion and one parent-site lead", () => {
  assert.deepEqual(run(201, false), ["show-result", "completed", "Lead", "scroll"]);
});
test("new embedded estimate delegates its sole conversion to the host", () => {
  assert.deepEqual(run(201, true), ["show-result", "completed", "scroll"]);
});
test("duplicate saved estimate restores the result without a second conversion", () => {
  for (const embedded of [true, false]) assert.deepEqual(run(200, embedded), ["show-result", "scroll"]);
});
test("only explicit created status can emit a conversion", () => {
  for (const status of [202, 204, 400, 422, 500]) {
    assert.deepEqual(run(status, false), ["show-result", "scroll"]);
  }
});
