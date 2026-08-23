import { test } from "node:test";
import assert from "node:assert/strict";

import {
  diffReports,
  projectHealth,
  type DailyReport,
  type ProjectCard,
} from "../app/lib/finance/daily-report.ts";
import { renderDailyReport, reportSubject } from "../app/lib/finance/daily-report-render.ts";
import { DEFAULT_FINANCE_SETTINGS } from "../app/lib/finance/settings.ts";

const S = DEFAULT_FINANCE_SETTINGS;

// --- Health labels (the words the field reads on a phone) -------------------

test("a project at goal is ON TRACK", () => {
  const { health } = projectHealth(
    { projectedMarginPct: 45, targetMarginPct: 45, remainingBudget: 10_000, projectedGrossProfit: 50_000 },
    S,
  );
  assert.equal(health, "ON TRACK");
});

test("margin 3 points under goal is WATCH", () => {
  const { health, reasons } = projectHealth(
    { projectedMarginPct: 42, targetMarginPct: 45, remainingBudget: 10_000, projectedGrossProfit: 40_000 },
    S,
  );
  assert.equal(health, "WATCH");
  assert.match(reasons.join(" "), /below goal/);
});

test("margin 6 points under goal is ACTION REQUIRED", () => {
  const { health } = projectHealth(
    { projectedMarginPct: 39, targetMarginPct: 45, remainingBudget: 10_000, projectedGrossProfit: 30_000 },
    S,
  );
  assert.equal(health, "ACTION REQUIRED");
});

test("a projected loss is ACTION REQUIRED regardless of margin math", () => {
  const { health, reasons } = projectHealth(
    { projectedMarginPct: null, targetMarginPct: 45, remainingBudget: 5_000, projectedGrossProfit: -1 },
    S,
  );
  assert.equal(health, "ACTION REQUIRED");
  assert.match(reasons.join(" "), /loss/i);
});

test("over budget (commitments included) is ACTION REQUIRED even at healthy margin", () => {
  const { health, reasons } = projectHealth(
    { projectedMarginPct: 46, targetMarginPct: 45, remainingBudget: -500, projectedGrossProfit: 60_000 },
    S,
  );
  assert.equal(health, "ACTION REQUIRED");
  assert.match(reasons.join(" "), /Over budget/);
});

test("no budget set never fakes a health signal from budget math", () => {
  const { health } = projectHealth(
    { projectedMarginPct: 45, targetMarginPct: 45, remainingBudget: null, projectedGrossProfit: 10_000 },
    S,
  );
  assert.equal(health, "ON TRACK");
});

test("a project with data gaps is never labelled healthy", () => {
  const { health, reasons } = projectHealth(
    {
      projectedMarginPct: 100,
      targetMarginPct: 45,
      remainingBudget: null,
      projectedGrossProfit: 34_800,
      dataComplete: false,
    },
    S,
  );
  assert.equal(health, "ACTION REQUIRED");
  assert.match(reasons.join(" "), /cannot be assessed/);
});

// --- Diff: what changed since yesterday -------------------------------------

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    p5Id: "P5-2026-0001",
    name: "Alder St Kitchen",
    division: "Boise Remodeling Co",
    customer: "Jane Doe",
    qboCustomerId: "42",
    status: "Active",
    contractValue: 100_000,
    originalBudget: 60_000,
    currentBudget: 60_000,
    committed: 5_000,
    actualCost: 20_000,
    remainingBudget: 35_000,
    budgetUsedPct: 41.7,
    invoiced: 50_000,
    paymentsReceived: 40_000,
    customerBalance: 60_000,
    outstandingInvoices: 10_000,
    outstandingBills: 3_000,
    projectedGrossProfit: 40_000,
    projectedMarginPct: 40,
    targetMarginPct: 45,
    health: "WATCH",
    healthReasons: ["Margin 5.0 pts below goal"],
    problems: [],
    ...overrides,
  };
}

function report(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    coversDate: "2026-08-22",
    generatedAt: "2026-08-22T13:00:00.000Z",
    qboConnected: true,
    lastSyncAt: "2026-08-22T12:00:00.000Z",
    company: {
      cash: { operating: 50_000, taxReserve: 10_000, operatingReserve: 10_000, undeposited: 0, total: 70_000 },
      safeCash: 20_000,
      safeCashProvisional: true,
      ar: { total: 10_000, overdue: 0, overdueCount: 0, count: 2 },
      ap: { total: 8_000, dueSoon: 3_000, dueSoonCount: 1, count: 3 },
      activity: {
        today: { invoiced: 0, collected: 0, billsEntered: 0, billsPaid: 0 },
        mtd: { invoiced: 50_000, collected: 40_000, billsEntered: 20_000, billsPaid: 17_000 },
        ytd: { invoiced: 50_000, collected: 40_000, billsEntered: 20_000, billsPaid: 17_000 },
      },
    },
    attention: { critical: 0, urgent: 0, warning: 0, items: [] },
    projects: [card()],
    upcoming: [],
    limitations: [],
    txns: [
      { id: "Bill:1", type: "Bill", date: "2026-08-20", total: 3_250, counterparty: "ABC Plumbing" },
      { id: "Payment:1", type: "Payment", date: "2026-08-21", total: 25_000, counterparty: "Jane Doe" },
    ],
    ...overrides,
  };
}

test("first report ever produces no changes (nothing to compare against)", () => {
  assert.deepEqual(diffReports(null, report()), []);
});

test("identical days produce no changes - a re-synced txn is never 'new'", () => {
  assert.deepEqual(diffReports(report(), report()), []);
});

test("a new bill and a new payment are both reported with counterparty and amount", () => {
  const today = report({
    txns: [
      ...report().txns,
      { id: "Bill:2", type: "Bill", date: "2026-08-22", total: 3_250, counterparty: "ABC Plumbing" },
      { id: "Payment:2", type: "Payment", date: "2026-08-22", total: 25_000, counterparty: "Jane Doe" },
    ],
  });
  const changes = diffReports(report(), today);
  const text = changes.map((c) => c.text).join(" | ");
  assert.match(text, /New vendor bill - ABC Plumbing/);
  assert.match(text, /Customer payment received - Jane Doe/);
  assert.equal(changes.find((c) => c.text.includes("vendor bill"))?.amount, 3_250);
});

test("a health transition is reported", () => {
  const today = report({ projects: [card({ health: "ACTION REQUIRED" })] });
  const changes = diffReports(report(), today);
  assert.match(changes.map((c) => c.text).join(" "), /WATCH -> ACTION REQUIRED/);
});

test("a new project is reported", () => {
  const today = report({
    projects: [card(), card({ p5Id: "P5-2026-0002", name: "Deck Build" })],
  });
  const changes = diffReports(report(), today);
  assert.match(changes.map((c) => c.text).join(" "), /New project added: P5-2026-0002/);
});

test("increased overdue receivables are called out", () => {
  const base = report();
  const today = report();
  today.company = { ...today.company!, ar: { ...today.company!.ar, overdue: 5_000 } };
  const changes = diffReports(base, today);
  assert.match(changes.map((c) => c.text).join(" "), /Overdue receivables increased/);
});

// --- Rendering --------------------------------------------------------------

test("subject leads with the worst news", () => {
  const clear = report();
  assert.match(reportSubject(clear), /no significant issues/);

  const bad = report({ attention: { critical: 2, urgent: 1, warning: 0, items: [] } });
  assert.match(reportSubject(bad), /2 critical/);

  const off = report({ qboConnected: false, company: null });
  assert.match(reportSubject(off), /QuickBooks not connected/);
});

test("the email contains every required section, in text and html", () => {
  const msg = renderDailyReport(report(), [], "https://p5homeco.com");
  for (const section of [
    "NEEDS YOUR ATTENTION",
    "COMPANY SNAPSHOT",
    "WHAT CHANGED SINCE YESTERDAY",
    "ACTIVE PROJECTS",
  ]) {
    assert.ok(msg.text.includes(section), `text missing ${section}`);
  }
  assert.match(msg.html, /Daily Financial Snapshot/);
  assert.match(msg.html, /P5-2026-0001/);
  assert.match(msg.html, /WATCH/);
  assert.match(msg.html, /p5homeco\.com\/admin\/finance\/daily-report/);
});

test("a disconnected report says so instead of showing figures", () => {
  const msg = renderDailyReport(
    report({ qboConnected: false, company: null, limitations: ["QuickBooks is not connected - no financial figures are available."] }),
    [],
    "https://p5homeco.com",
  );
  assert.match(msg.text, /QuickBooks is not connected/);
  assert.ok(!msg.text.includes("Cash total"));
});

test("missing budget renders as 'no budget set', never as a number", () => {
  const msg = renderDailyReport(
    report({ projects: [card({ currentBudget: 0, remainingBudget: null, budgetUsedPct: null, problems: ["No budget set"] })] }),
    [],
    "https://p5homeco.com",
  );
  assert.match(msg.text, /no budget set/);
  assert.match(msg.text, /! No budget set/);
});

test("html escapes counterparty names", () => {
  const msg = renderDailyReport(
    report({ projects: [card({ customer: 'Acme <script>alert(1)</script>' })] }),
    [],
    "https://p5homeco.com",
  );
  assert.ok(!msg.html.includes("<script>alert"));
});
