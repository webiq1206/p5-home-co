import { test } from "node:test";
import assert from "node:assert/strict";

import { ForbiddenError, assertCan, can, seesAllLeads } from "../app/lib/leads/permissions.ts";
import { ROLES, type Role } from "../app/lib/leads/types.ts";

test("an administrator can do everything the panel offers", () => {
  for (const p of [
    "manage_users", "manage_integrations", "manage_settings", "view_audit_log",
    "retry_jobs", "view_all_leads", "assign_lead", "move_stage",
  ] as const) {
    assert.equal(can("administrator", p), true, `administrator should have ${p}`);
  }
});

test("only administrators manage users, integrations, settings, and jobs", () => {
  const restricted = ["manage_users", "manage_integrations", "manage_settings", "retry_jobs", "view_audit_log"] as const;
  for (const role of ROLES) {
    for (const p of restricted) {
      assert.equal(
        can(role, p),
        role === "administrator",
        `${role} should ${role === "administrator" ? "have" : "not have"} ${p}`,
      );
    }
  }
});

test("a sales rep sees only assigned leads and cannot reassign them", () => {
  assert.equal(can("sales_rep", "view_assigned_leads"), true);
  assert.equal(can("sales_rep", "view_all_leads"), false);
  assert.equal(can("sales_rep", "assign_lead"), false);
  assert.equal(seesAllLeads("sales_rep"), false);
});

test("coordinators and managers see the whole board", () => {
  assert.equal(seesAllLeads("lead_coordinator"), true);
  assert.equal(seesAllLeads("manager"), true);
  assert.equal(seesAllLeads("administrator"), true);
});

test("a project manager sees assigned work and holds no pipeline controls", () => {
  assert.equal(can("project_manager", "view_assigned_leads"), true);
  for (const p of ["move_stage", "assign_lead", "log_outcome", "contact_lead", "view_all_leads"] as const) {
    assert.equal(can("project_manager", p), false, `project_manager must not have ${p}`);
  }
});

test("a manager receives escalations and can reassign, but cannot change settings", () => {
  assert.equal(can("manager", "assign_lead"), true);
  assert.equal(can("manager", "resolve_exceptions"), true);
  assert.equal(can("manager", "view_reports"), true);
  assert.equal(can("manager", "manage_settings"), false);
});

test("assertCan throws ForbiddenError naming the permission", () => {
  assert.throws(
    () => assertCan({ role: "sales_rep" }, "manage_users"),
    (err: unknown) => err instanceof ForbiddenError && /manage_users/.test((err as Error).message),
  );
  assert.doesNotThrow(() => assertCan({ role: "administrator" }, "manage_users"));
});

test("every role is covered by the matrix, so a new role cannot silently get nothing", () => {
  for (const role of ROLES) {
    const anyPermission = (["view_all_leads", "view_assigned_leads"] as const).some((p) =>
      can(role as Role, p),
    );
    assert.equal(anyPermission, true, `${role} has no lead visibility at all`);
  }
});
