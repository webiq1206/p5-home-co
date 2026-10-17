import assert from "node:assert/strict";
import test from "node:test";

import { googleAdsDestinationId, googleAdsLeadLabel } from "../app/site.ts";
import { adsConversionsToSend, projectIdentity, trackGoogleAdsLeadConversion } from "../lib/googleAdsConversion.ts";

const ESTIMATOR = "AW-18354188204/cEzmCPOagKAdEKzf-q9E";
const FORM = `${googleAdsDestinationId}/${googleAdsLeadLabel}`;

type Conversion = { send_to: string; transaction_id: string };
type Calls = Array<[string, string, Conversion]>;

function install(options: {
  hostname?: string;
  pathname?: string;
  webdriver?: boolean;
  disabled?: boolean;
  gtag?: boolean;
  storage?: Map<string, string>;
} = {}) {
  const storage = options.storage ?? new Map<string, string>();
  if (options.disabled) storage.set("p5_analytics_disabled", "1");
  const calls: Calls = [];
  const view: {
    location: { hostname: string; pathname: string };
    navigator: { webdriver: boolean };
    sessionStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
    gtag?: (...args: unknown[]) => void;
  } = {
    location: { hostname: options.hostname ?? "p5homeco.com", pathname: options.pathname ?? "/estimate" },
    navigator: { webdriver: options.webdriver ?? false },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
    },
  };
  if (options.gtag !== false) view.gtag = (...args: unknown[]) => { calls.push(args as Calls[number]); };
  Object.assign(globalThis, { window: view });
  return { calls, storage, view };
}

function cleanup() {
  Reflect.deleteProperty(globalThis, "window");
}

test("the form label stays the accepted-inquiry label", () => {
  assert.equal(FORM, "AW-18354188204/LE2vCPXstO8cEKzf-q9E");
});

test("an intake completion fires the estimator label only, once, with its key", async () => {
  const { calls } = install();
  try {
    assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "intake:project-1"), true);
    assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "intake:project-1"), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, [["event", "conversion", { send_to: ESTIMATOR, transaction_id: "intake:project-1" }]]);
  } finally { cleanup(); }
});

test("an estimator completion fires the estimator label only", async () => {
  const { calls } = install();
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "estimator:draft-9"), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, [["event", "conversion", { send_to: ESTIMATOR, transaction_id: "estimator:draft-9" }]]);
  } finally { cleanup(); }
});

test("any other key fires the form label only", async () => {
  const { calls } = install();
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "quote:lead-4"), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, [["event", "conversion", { send_to: FORM, transaction_id: "quote:lead-4" }]]);
  } finally { cleanup(); }
});

test("a repeated completion does not fire again after the tag was slow", async () => {
  const { calls, view } = install({ gtag: false });
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:slow-1"), true);
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:slow-1"), false);
    view.gtag = (...args: unknown[]) => { calls.push(args as Calls[number]); };
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].transaction_id, "intake:slow-1");
  } finally { cleanup(); }
});

test("session storage blocks a second page view of the same completion", () => {
  const storage = new Map<string, string>([[`p5_ads_fired:${ESTIMATOR}\nintake:remembered`, "1"]]);
  const { calls } = install({ storage });
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:remembered"), false);
    assert.equal(calls.length, 0);
  } finally { cleanup(); }
});

test("www is allowed and other hosts, webdriver, the opt-out, and saved QA are not", () => {
  try {
    const live = install({ hostname: "www.p5homeco.com" });
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:www"), true);
    assert.equal(live.calls.length, 1);
    cleanup();

    for (const options of [
      { hostname: "localhost" },
      { hostname: "preview.p5homeco.com" },
      { webdriver: true },
      { disabled: true },
      { pathname: "/estimate/qa-saved" },
      { pathname: "/estimate/qa-saved/replay" },
    ]) {
      const blocked = install(options);
      assert.equal(trackGoogleAdsLeadConversion({}, `intake:${options.hostname || options.pathname || "web"}`), false, JSON.stringify(options));
      assert.equal(blocked.calls.length, 0);
      cleanup();
    }
  } finally { cleanup(); }
});

test("the tag is polled for about five seconds and a late tag is not used", async () => {
  const { calls, view } = install({ gtag: false });
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:late"), true);
    await new Promise((resolve) => setTimeout(resolve, 5200));
    view.gtag = (...args: unknown[]) => { calls.push(args as Calls[number]); };
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls.length, 0);
  } finally { cleanup(); }
});

test("one accepted lead gets one form label across both finishes, and each finish keeps its own estimator label", () => {
  const project = "11111111-1111-4111-8111-111111111111";
  const intakeKey = `intake:p5:${project}`;
  const estimatorKey = `estimator:${project}`;
  assert.equal(projectIdentity(intakeKey), project);
  assert.equal(projectIdentity(estimatorKey), project);
  const { calls } = install();
  try {
    const intake = adsConversionsToSend(intakeKey, true);
    const estimator = adsConversionsToSend(estimatorKey, true);
    const repeated = adsConversionsToSend(intakeKey, true);
    assert.deepEqual(intake, [
      { sendTo: ESTIMATOR, transactionId: intakeKey },
      { sendTo: FORM, transactionId: project },
    ]);
    assert.deepEqual(estimator, [
      { sendTo: ESTIMATOR, transactionId: estimatorKey },
    ]);
    assert.deepEqual(repeated, []);
    assert.equal(intake.filter((event) => event.sendTo === FORM).length, 1);
    assert.equal(estimator.some((event) => event.sendTo === FORM), false);
    assert.equal(calls.length, 0);
  } finally { cleanup(); }
});

test("a finish that did not create an accepted lead fires only the estimator label", () => {
  const project = "22222222-2222-4222-8222-222222222222";
  const { calls } = install();
  try {
    assert.deepEqual(adsConversionsToSend(`intake:p5:${project}`, false), [
      { sendTo: ESTIMATOR, transactionId: `intake:p5:${project}` },
    ]);
    assert.deepEqual(adsConversionsToSend(`estimator:${project}`, false), [
      { sendTo: ESTIMATOR, transactionId: `estimator:${project}` },
    ]);
    assert.equal(calls.some((call) => call[2].send_to === FORM), false);
  } finally { cleanup(); }
});

test("a thrown gtag call does not escape the completion", async () => {
  const { view } = install({ gtag: false });
  view.gtag = () => { throw new Error("tag rejected"); };
  try {
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:throws"), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(trackGoogleAdsLeadConversion({}, "intake:throws"), false);
  } finally { cleanup(); }
});
