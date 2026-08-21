/**
 * Role permissions.
 *
 * Pure and dependency-free so the matrix can be tested directly, and so the
 * same check runs on the server before an action and in the UI to decide
 * whether the control is rendered at all. Unauthorized actions are hidden
 * rather than shown-and-rejected.
 */

import type { Role } from "./types.ts";

/**
 * Every action the admin panel can take.
 *
 * Named actions rather than resource+verb pairs, so a permission check reads
 * the way the brief describes the job.
 */
export type Permission =
  | "view_all_leads"
  | "view_assigned_leads"
  | "contact_lead"
  | "assign_lead"
  | "log_outcome"
  | "set_next_action"
  | "move_stage"
  | "schedule_appointment"
  | "manage_users"
  | "manage_integrations"
  | "manage_settings"
  | "view_audit_log"
  | "view_integration_health"
  | "view_reports"
  | "retry_jobs"
  | "resolve_exceptions"
  | "edit_handoff_reference";

const PERMISSIONS: Record<Role, Permission[]> = {
  administrator: [
    "view_all_leads", "view_assigned_leads", "contact_lead", "assign_lead",
    "log_outcome", "set_next_action", "move_stage", "schedule_appointment",
    "manage_users", "manage_integrations", "manage_settings", "view_audit_log",
    "view_integration_health", "view_reports", "retry_jobs", "resolve_exceptions",
    "edit_handoff_reference",
  ],
  manager: [
    "view_all_leads", "view_assigned_leads", "contact_lead", "assign_lead",
    "log_outcome", "set_next_action", "move_stage", "schedule_appointment",
    "view_reports", "resolve_exceptions", "edit_handoff_reference",
  ],
  lead_coordinator: [
    "view_all_leads", "view_assigned_leads", "contact_lead", "assign_lead",
    "log_outcome", "set_next_action", "move_stage", "schedule_appointment",
    "edit_handoff_reference",
  ],
  sales_rep: [
    "view_assigned_leads", "contact_lead", "log_outcome", "set_next_action",
    "move_stage", "schedule_appointment",
  ],
  // Sees won projects and operational notes only; no pipeline controls.
  project_manager: ["view_assigned_leads"],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

/** Roles that see every lead rather than only their own. */
export function seesAllLeads(role: Role): boolean {
  return can(role, "view_all_leads");
}

/** Thrown when an action is attempted without the permission for it. */
export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Not permitted: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(user: { role: Role }, permission: Permission): void {
  if (!can(user.role, permission)) throw new ForbiddenError(permission);
}
