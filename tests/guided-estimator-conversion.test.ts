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
const reportStart = source.indexOf("const project = extra.project ?? flow?.id ?? null;");
const reportEnd = source.indexOf("\n    },", reportStart);
assert.ok(reportStart >= 0 && reportEnd > reportStart);
// Erase only the callback's TypeScript window cast for the isolated VM.
const reportBody = source.slice(reportStart, reportEnd).replace(
  "(window as unknown as { gtag?: (...args: unknown[]) => void })",
  "window",
);

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

test("embedded duplicate sends no beacon, tag event or host completion message", () => {
  for (const status of [201, 200]) {
    const messages: unknown[] = [];
    const tags: unknown[] = [];
    const beacons: string[] = [];
    const context = vm.createContext({
      json: { ok: true, estimate: {} }, response: { status }, embedded: true,
      setEstimate: () => {}, trackAcceptedInquiry: () => assert.fail("iframe must not send its own Lead"),
      Blob, session: { current: "synthetic-session" }, brand: { id: "handyman" },
      flow: { id: "repairs" }, attribution: { current: {} }, extra: {}, name: "completed",
      navigator: { sendBeacon: (url: string) => { beacons.push(url); return true; } },
      window: { scrollTo: () => {}, gtag: (...args: unknown[]) => tags.push(args), parent: { postMessage: (message: unknown) => messages.push(message) } },
    });
    Object.assign(context, { report: () => vm.runInContext(reportBody, context) });
    vm.runInContext(successBlock, context);
    const count = status === 201 ? 1 : 0;
    assert.equal(messages.length, count);
    assert.equal(tags.length, count);
    assert.equal(beacons.length, count);
    if (count) assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
      type: "p5-estimator", name: "estimator_completed", brand: "handyman", project: "repairs",
    });
  }
});
