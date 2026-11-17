/**
 * Stage alignment between QuickBooks estimates, the P5 lead and HubSpot
 * (owner, 17 November 2026): the rules as pure functions, and the places the
 * rest of the code calls them from. No database, no network. The behaviour
 * end to end is in tests/stage-alignment.integration.test.ts.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DECLINED_IN_QUICKBOOKS,
  alignedStage,
  estimateWorked,
  isRemovalReason,
  quickBooksStageWriteEnabled,
  quickBooksStatusForClosedLead,
  stageAlignmentEnabled,
  stageForEstimate,
} from "../app/lib/leads/stage-alignment.ts";
import { DEAL_STAGES } from "../app/lib/leads/types.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OPEN_STAGES = DEAL_STAGES.filter((stage) => stage !== "Closed Won" && stage !== "Closed Lost");
const lead = (stage: string, closedLostReason: string | null = null) => ({ stage, closedLostReason });
const estimate = (status: string, extra: Partial<{ worked: boolean; otherLiveEstimate: boolean }> = {}) => ({ status, worked: true, otherLiveEstimate: false, ...extra });

describe("stage alignment rules", () => {
  test("every estimate status maps to the stage in the owner's table", () => {
    assert.equal(stageForEstimate("created_unsent", true), "Estimate in Progress");
    assert.equal(stageForEstimate("sent", true), "Estimate Sent");
    for (const status of ["accepted", "converted", "paid"]) assert.equal(stageForEstimate(status, true), "Closed Won");
    assert.equal(stageForEstimate("declined", true), "Closed Lost");
    for (const status of ["closed", "deleted", "not_created", "unavailable", "something new"]) {
      assert.equal(stageForEstimate(status, true), null, `${status} changes nothing`);
    }
  });

  test("an unsent estimate nobody has worked changes nothing; every other status does not depend on it", () => {
    assert.equal(stageForEstimate("created_unsent", false), null);
    assert.equal(stageForEstimate("sent", false), "Estimate Sent");
    assert.equal(stageForEstimate("accepted", false), "Closed Won");
    assert.equal(stageForEstimate("declined", false), "Closed Lost");
    assert.equal(alignedStage(lead("New Lead"), estimate("created_unsent", { worked: false })), null);
    assert.deepEqual(alignedStage(lead("New Lead"), estimate("created_unsent")), { stage: "Estimate in Progress", closedLostReason: null });
  });

  test("worked means a staff member created it, or QuickBooks has saved it again since it was created", () => {
    assert.equal(estimateWorked({ SyncToken: "0" }, null), false, "the website's own creation");
    assert.equal(estimateWorked({ SyncToken: "1" }, null), true, "saved again: a staff revision or an edit in QuickBooks");
    assert.equal(estimateWorked({ SyncToken: 3 }, null), true);
    assert.equal(estimateWorked({ SyncToken: "0" }, 7), true, "created by a staff member from the scope platform");
    assert.equal(estimateWorked({ SyncToken: "0" }, "7"), true);
    for (const raw of [null, undefined, {}, { SyncToken: "" }, { SyncToken: "abc" }, { SyncToken: null }, { SyncToken: "-1" }]) {
      assert.equal(estimateWorked(raw as never, null), false, `an unreadable token is not proof: ${JSON.stringify(raw)}`);
    }
  });

  test("open stages only move forward", () => {
    for (const stage of OPEN_STAGES) {
      const position = DEAL_STAGES.indexOf(stage);
      const inProgress = alignedStage(lead(stage), estimate("created_unsent"));
      const sent = alignedStage(lead(stage), estimate("sent"));
      assert.equal(inProgress?.stage ?? null, position < DEAL_STAGES.indexOf("Estimate in Progress") ? "Estimate in Progress" : null, `${stage} + unsent`);
      assert.equal(sent?.stage ?? null, position < DEAL_STAGES.indexOf("Estimate Sent") ? "Estimate Sent" : null, `${stage} + sent`);
    }
    assert.equal(alignedStage(lead("Decision Pending"), estimate("created_unsent")), null);
    assert.equal(alignedStage(lead("Decision Pending"), estimate("sent")), null);
  });

  test("an acceptance wins any open lead, and a decline loses it only when no other estimate is live", () => {
    for (const stage of OPEN_STAGES) {
      for (const status of ["accepted", "converted", "paid"]) {
        assert.deepEqual(alignedStage(lead(stage), estimate(status)), { stage: "Closed Won", closedLostReason: null });
      }
      assert.deepEqual(alignedStage(lead(stage), estimate("declined")), { stage: "Closed Lost", closedLostReason: DECLINED_IN_QUICKBOOKS });
      assert.equal(alignedStage(lead(stage), estimate("declined", { otherLiveEstimate: true })), null);
    }
  });

  test("a won lead is never moved", () => {
    for (const status of ["created_unsent", "sent", "accepted", "converted", "paid", "declined", "closed", "deleted"]) {
      assert.equal(alignedStage(lead("Closed Won"), estimate(status)), null, status);
    }
  });

  test("a lost lead is won by an acceptance and by nothing else, and never when it was removed or merged", () => {
    for (const status of ["accepted", "converted", "paid"]) {
      assert.deepEqual(alignedStage(lead("Closed Lost", "Price"), estimate(status)), { stage: "Closed Won", closedLostReason: null });
      assert.deepEqual(alignedStage(lead("Closed Lost", DECLINED_IN_QUICKBOOKS), estimate(status)), { stage: "Closed Won", closedLostReason: null });
      for (const reason of ["Removed in HubSpot", "Merged into another deal in HubSpot", "Removed in QuickBooks"]) {
        assert.equal(alignedStage(lead("Closed Lost", reason), estimate(status)), null, `${reason} stays closed`);
      }
    }
    for (const status of ["created_unsent", "sent", "declined", "closed", "deleted"]) {
      assert.equal(alignedStage(lead("Closed Lost", "Price"), estimate(status)), null, `${status} does not reopen a lost lead`);
    }
  });

  test("a stage this code has no name for is left alone", () => {
    assert.equal(alignedStage(lead("Job Complete"), estimate("accepted")), null);
    assert.equal(alignedStage(lead(""), estimate("sent")), null);
  });

  test("the removal reasons are the ones the deletion code writes", async () => {
    const removed = await import("../app/lib/integrations/hubspot-removed.ts");
    const everywhere = await import("../app/lib/leads/removed-everywhere.ts");
    for (const reason of [removed.REMOVED_IN_HUBSPOT, removed.MERGED_IN_HUBSPOT, everywhere.REMOVED_IN_QUICKBOOKS]) {
      assert.equal(isRemovalReason(reason), true, reason);
    }
    for (const reason of [null, "", "Price", DECLINED_IN_QUICKBOOKS]) assert.equal(isRemovalReason(reason), false);
  });

  test("a closed lead sets Accepted or Rejected, except where the close came from a deletion, a merge or QuickBooks itself", () => {
    assert.equal(quickBooksStatusForClosedLead("Closed Won", null), "Accepted");
    assert.equal(quickBooksStatusForClosedLead("Closed Lost", "Price"), "Rejected");
    assert.equal(quickBooksStatusForClosedLead("Closed Lost", null), "Rejected");
    for (const reason of ["Removed in HubSpot", "Merged into another deal in HubSpot", "Removed in QuickBooks", DECLINED_IN_QUICKBOOKS]) {
      assert.equal(quickBooksStatusForClosedLead("Closed Lost", reason), null, reason);
    }
    for (const stage of OPEN_STAGES) assert.equal(quickBooksStatusForClosedLead(stage, null), null, `${stage} is open: a reopened lead writes nothing`);
  });

  test("the kill switches", () => {
    assert.equal(stageAlignmentEnabled({}), true);
    assert.equal(stageAlignmentEnabled({ STAGE_ALIGNMENT: " OFF " }), false);
    assert.equal(stageAlignmentEnabled({ STAGE_ALIGNMENT: "on" }), true);
    assert.equal(quickBooksStageWriteEnabled({}), true);
    assert.equal(quickBooksStageWriteEnabled({ STAGE_ALIGNMENT_QUICKBOOKS_WRITE: "off" }), false);
    assert.equal(stageAlignmentEnabled({ STAGE_ALIGNMENT_QUICKBOOKS_WRITE: "off" }), true, "only the QuickBooks writes stop");
    assert.equal(quickBooksStageWriteEnabled({ STAGE_ALIGNMENT: "off" }), false, "everything off includes the writes");
  });
});

describe("stage alignment is wired in as hooks, and nowhere else", () => {
  const source = read("app/lib/leads/stage-alignment.ts");

  test("every estimate status passes through it, without ever failing the caller", () => {
    const store = read("app/lib/scopes/store.ts");
    const body = store.slice(store.indexOf("export async function applyEstimateStatus"), store.indexOf("export async function estimateStatusError"));
    assert.match(body, /try \{\s*const alignment = await import\("\.\.\/leads\/stage-alignment\.ts"\);\s*await alignment\.onEstimateStatusApplied\(estimateId\);\s*\} catch/);
    assert.ok(body.indexOf("onEstimateStatusApplied") > body.indexOf("scope_estimate_snapshot"), "after the status is stored");
    assert.doesNotMatch(store, /^import .*stage-alignment/m, "loaded on demand, so the scope platform never depends on it");
  });

  test("invoices and payments reach it from the QuickBooks read model", () => {
    const sync = read("app/lib/finance/qbo/sync.ts");
    assert.match(sync, /\(entity === "Invoice" \|\| entity === "Payment"\) && r\.Id\) \{\s*try \{\s*const alignment = await import\("\.\.\/\.\.\/leads\/stage-alignment\.ts"\);\s*await alignment\.onQuickBooksTxn\(entity, r\);\s*\} catch/);
    assert.doesNotMatch(sync, /^import .*stage-alignment/m);
  });

  test("a deal closed in HubSpot reaches it after the read-back transaction, with the stage it replaced", () => {
    const operations = read("app/lib/integrations/hubspot-operations.ts");
    assert.match(operations, /SELECT id,hubspot_deal_id,updated_at::text AS revision,stage FROM deal/);
    const transactionEnd = operations.indexOf("return true;\n      });");
    const hook = operations.indexOf("alignment.onLeadStageChanged(Number(row.id), row.stage, stage)");
    assert.ok(transactionEnd > 0 && hook > transactionEnd, "after the transaction, never inside it");
    assert.match(operations, /if \(applied && stage && stage !== row\.stage\) \{\s*try \{/);
  });

  test("a lead closed in the admin reaches it after the transaction commits, bounded, with the previous stage", () => {
    const actions = read("app/admin/actions.ts");
    const commit = actions.indexOf("previousStage: prev.stage };\n  });");
    const hook = actions.indexOf("await onLeadStageChanged(dealId, previousStage, stage, { waitMs: 6_000 });");
    assert.ok(commit > 0 && hook > commit, "after the transaction, never inside it");
    assert.equal(actions.split("onLeadStageChanged(").length - 1, 1, "one call, in logOutcomeAction");
  });

  test("the watchdog retries it beside the QuickBooks cleanup, in its own try", () => {
    const watchdog = read("app/lib/leads/watchdog.ts");
    const cleanup = watchdog.indexOf("await settleRemovedLeads();");
    const retry = watchdog.indexOf("await settleStageAlignment();");
    assert.ok(cleanup > 0 && retry > cleanup);
    assert.match(watchdog, /try \{\s*const \{ settleStageAlignment \} = await import\("\.\/stage-alignment\.ts"\);\s*await settleStageAlignment\(\);\s*\} catch/);
  });

  test("the deletion rules were not touched: an untouched lead is still a New Lead nobody has contacted", () => {
    const everywhere = read("app/lib/leads/removed-everywhere.ts");
    assert.match(everywhere, /const untouched = lead\.stage === "New Lead" && !lead\.first_attempt_at && !lead\.first_two_way_at && !lead\.appointment_at;/);
    assert.doesNotMatch(everywhere, /stage-alignment/);
  });

  test("P5 gains no new stage, and the module adds none", () => {
    assert.deepEqual([...DEAL_STAGES], ["New Lead", "Contacting", "Appointment Scheduled", "Estimate in Progress", "Estimate Sent", "Decision Pending", "Closed Won", "Closed Lost"]);
    assert.doesNotMatch(source, /stage\s*=\s*'Job Complete'/);
  });

  test("the guard runs in the lead-integrations job and on changes to the module", () => {
    const workflow = read(".github/workflows/p5-estimator-verification.yml");
    assert.match(workflow, /node --test --test-concurrency=1 [^\n]*tests\/stage-alignment\.integration\.test\.ts/);
    const paths = workflow.split("\n").find((line) => line.trim().startsWith("paths:")) ?? "";
    assert.ok(paths.includes("'tests/stage-alignment.integration.test.ts'"));
    assert.ok(paths.includes("'app/lib/leads/stage-alignment.ts'"));
  });

  test("house style: no em dashes in the module, its tests or its section of CLAUDE.md", () => {
    const section = read("CLAUDE.md").split("## Stage alignment")[1]?.split("\n## ")[0] ?? "";
    assert.ok(section.length > 200, "CLAUDE.md has the section");
    for (const [name, text] of [["module", source], ["CLAUDE.md section", section], ["integration test", read("tests/stage-alignment.integration.test.ts")], ["unit test", read("tests/stage-alignment.test.ts")]] as const) {
      assert.equal(text.includes(String.fromCharCode(0x2014)), false, name);
    }
  });
});
