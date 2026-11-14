import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HubSpotDiagnosticError, hubSpotRequestOperation, hubSpotFailureCode, countHubSpotFailure, hubSpotFailureSummary, type HubSpotFailureCode } from '../app/lib/integrations/hubspot-diagnostics.ts';

test('bounded categories distinguish API, portal, dates, mapping and uncertain delivery', () => {
  for (const code of ['http_401', 'http_403', 'http_404', 'http_429', 'http_500', 'portal_verification', 'network_or_timeout', 'invalid_response', 'unmapped_stage', 'invalid_action_date', 'future_action_date', 'uncertain_task_creation'] as const) {
    assert.equal(hubSpotFailureCode(new HubSpotDiagnosticError(code)), code);
  }
});
test('provider messages, database detail and arbitrary exceptions cannot reach health summaries', () => {
  const privateText = 'customer@example.com Bearer SECRET https://private.invalid';
  const failures = new Map<HubSpotFailureCode, number>();
  countHubSpotFailure(failures, Object.assign(new Error(privateText), { code: '23505', detail: privateText }));
  countHubSpotFailure(failures, new Error(privateText));
  countHubSpotFailure(failures, { diagnosticCode: privateText, status: 404, message: privateText });
  countHubSpotFailure(failures, new HubSpotDiagnosticError('http_404'));
  countHubSpotFailure(failures, new HubSpotDiagnosticError('http_404'));
  assert.equal(hubSpotFailureSummary(failures), 'database_error=1, http_404=2, unexpected_error=2');
});
test('absent and malformed errors stay classified without throwing', () => {
  for (const error of [null, undefined, 123, 'secret', { code: 'secret' }]) {
    assert.equal(hubSpotFailureCode(error), 'unexpected_error');
  }
  assert.equal(hubSpotFailureSummary(new Map()), '');
});
test('diagnostics preserve creation recovery boundaries and guards', () => {
  const tasks = readFileSync(new URL('../app/lib/integrations/hubspot-tasks.ts', import.meta.url), 'utf8');
  const operations = readFileSync(new URL('../app/lib/integrations/hubspot-operations.ts', import.meta.url), 'utf8');
  assert.match(tasks, /await ensureP5HubSpotPortal/);
  assert.match(tasks, /error instanceof TaskApiError && \[400, 401, 403, 404, 422, 429\]\.includes\(error.status\)/);
  assert.match(tasks, /if \(row.create_attempted_at\) \{\s*throw new HubSpotDiagnosticError\("uncertain_task_creation"\)/);
  assert.match(tasks, /AND create_attempted_at IS NULL AND hubspot_task_id IS NULL/);
  assert.match(tasks, /\[row.id, countHubSpotFailure\(failures, error\)\]/);
  assert.match(operations, /countHubSpotFailure\(failures, error\)/);
  assert.match(operations, /hubSpotFailureSummary\(failures\)/);
  assert.doesNotMatch(tasks, /\(error as Error\)\.message/);
});

test('request operations are bounded and omit private route components', () => {
  for (const [path, method, operation] of [
    ['/crm/v3/objects/tasks/private-id?properties=secret', 'GET', 'task_read'],
    ['/crm/v3/objects/tasks/private-id', 'PATCH', 'task_complete'],
    ['/crm/v3/objects/deals/private-id', 'GET', 'deal_read'],
    ['/crm/v3/objects/tasks/search', 'POST', 'task_search'],
    ['/crm/v3/objects/tasks', 'POST', 'task_create'],
    ['/crm/v3/owners/?after=secret', 'GET', 'owner_read'],
    ['/crm/v4/associations/tasks/contacts/labels', 'GET', 'association_read'],
    ['/unknown/private-id', 'GET', 'other_request'],
  ]) assert.equal(hubSpotRequestOperation(path, method), operation);
});
