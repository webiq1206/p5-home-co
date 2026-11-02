import assert from 'node:assert/strict';

/** Only the intentional public intake redirect may share its target's metadata. */
export function canonicalAuditRoute(requestedPath, responseUrl, origin) {
  const resolved = new URL(responseUrl);
  assert.equal(resolved.origin, new URL(origin).origin, 'Unexpected cross-origin redirect');
  const path = resolved.pathname.replace(/\/$/, '') || '/';
  const requested = requestedPath.replace(/\/$/, '') || '/';
  if (path !== requested) {
    assert.equal(requested, '/estimate', `Unexpected redirect from ${requested}`);
    assert.equal(path, '/quote', 'The retired estimate URL must resolve to /quote');
  }
  return path;
}
