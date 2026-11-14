/** Bounded operational diagnostics. Never persist provider bodies, URLs or customer data. */
type HubSpotBaseFailureCode =
  | 'portal_verification' | 'network_or_timeout' | 'invalid_response'
  | 'unmapped_stage' | 'invalid_action_date' | 'future_action_date'
  | 'database_error' | 'unexpected_error' | 'waiting_for_lead_sync'
  | 'duplicate_incident_tasks' | 'uncertain_task_creation'
  | 'missing_task_owner' | 'missing_association_type'
  | 'archived_record_review_required' | 'archive_review_persistence_unavailable'
  | `http_${number}`;

export type HubSpotOperation = 'task_read' | 'deal_read' | 'task_search' | 'task_complete' | 'task_create' | 'owner_read' | 'association_read' | 'other_request';
export type HubSpotFailureCode = HubSpotBaseFailureCode | `${HubSpotOperation}:${HubSpotBaseFailureCode}`;

/** Classify only fixed route shapes. Never retain the path, query, object ID or body. */
export function hubSpotRequestOperation(path: string, method = 'GET'): HubSpotOperation {
  const route = path.split('?')[0];
  if (route === '/crm/v3/objects/tasks/search' && method === 'POST') return 'task_search';
  if (route === '/crm/v3/objects/tasks' && method === 'POST') return 'task_create';
  if (/^\/crm\/v3\/objects\/tasks\/[^/]+$/.test(route)) {
    if (method === 'GET') return 'task_read';
    if (method === 'PATCH') return 'task_complete';
  }
  if (/^\/crm\/v3\/objects\/deals\/[^/]+$/.test(route) && method === 'GET') return 'deal_read';
  if (route === '/crm/v3/owners/' && method === 'GET') return 'owner_read';
  if (/^\/crm\/v4\/associations\/tasks\/(deals|contacts)\/labels$/.test(route) && method === 'GET') return 'association_read';
  return 'other_request';
}

export class HubSpotDiagnosticError extends Error {
  readonly diagnosticCode: HubSpotFailureCode;
  constructor(code: HubSpotFailureCode) {
    super(code);
    this.name = 'HubSpotDiagnosticError';
    this.diagnosticCode = code;
  }
}

export function hubSpotFailureCode(error: unknown): HubSpotFailureCode {
  if (error instanceof HubSpotDiagnosticError) return error.diagnosticCode;
  // PostgreSQL SQLSTATEs are five uppercase alphanumeric characters. Do not
  // retain message/detail/query: these may contain customer data or secrets.
  if (error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) return 'database_error';
  return 'unexpected_error';
}

export function countHubSpotFailure(counts: Map<HubSpotFailureCode, number>, error: unknown): HubSpotFailureCode {
  const code = hubSpotFailureCode(error);
  counts.set(code, (counts.get(code) ?? 0) + 1);
  return code;
}

export function hubSpotFailureSummary(counts: Map<HubSpotFailureCode, number>): string {
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code}=${count}`).join(', ');
}
