import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { prepareEvidence } from '../scripts/prepare-ci-evidence.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function fixture(t, group = 'mobile') {
  const root = await mkdtemp(path.join(tmpdir(), 'cabinet-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, group === 'mobile' ? 'p5-mobile-seo-verification' : 'p5-verification');
  await mkdir(dir); return { root, dir, group };
}
test('complete archive retains bytes and manifest hashes', async t => {
  const f = await fixture(t); const bytes = Buffer.from('full failure report\n');
  await writeFile(path.join(f.dir, 'failed.json'), bytes);
  const result = await prepareEvidence(f);
  const extracted = execFileSync('tar', ['-xOzf', result.archive, './p5-mobile-seo-verification/failed.json']);
  assert.deepEqual(extracted, bytes);
  assert.equal(result.files[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(path.join(f.dir, 'failed.json')), bytes);
});
test('estimator includes full log and browser evidence', async t => {
  const f = await fixture(t, 'estimator'); const log = path.join(f.root, 'server.log');
  await writeFile(log, 'all log lines'); await writeFile(path.join(f.dir, 'result.json'), '{"passed":false}');
  const result = await prepareEvidence({ ...f, estimatorLog: log });
  assert.equal(result.files.length, 2);
  assert.equal(execFileSync('tar', ['-xOzf', result.archive, './p5-estimator-server.log']).toString(), 'all log lines');
});
test('raw oversize fails, preserves source, removes stale archive', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, 'large'), '12345');
  await mkdir(path.join(f.root, 'ci-evidence-artifacts')); await writeFile(path.join(f.root, 'ci-evidence-artifacts/mobile.tar.gz'), 'stale');
  await assert.rejects(prepareEvidence({ ...f, maxBytes: 4 }), /raw size/);
  assert.equal(await readFile(path.join(f.dir, 'large'), 'utf8'), '12345');
  await assert.rejects(stat(path.join(f.root, 'ci-evidence-artifacts/mobile.tar.gz')), { code: 'ENOENT' });
});
test('compressed archive limit includes manifest and overhead', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, 'random'), randomBytes(128));
  await assert.rejects(prepareEvidence({ ...f, maxBytes: 128 }), /archive exceeds/);
});
test('file count limit fails without dropping evidence', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, 'a'), 'a'); await writeFile(path.join(f.dir, 'b'), 'b');
  await assert.rejects(prepareEvidence({ ...f, maxFiles: 1 }), /file-count/);
});
test('empty evidence fails', async t => {
  const f = await fixture(t); assert.equal((await prepareEvidence(f)).valid, false);
});
test('missing browser directory fails', async t => {
  const f = await fixture(t); await rm(f.dir, { recursive: true });
  assert.equal((await prepareEvidence(f)).valid, false);
});
test('missing estimator log fails', async t => {
  const f = await fixture(t, 'estimator'); await writeFile(path.join(f.dir, 'result'), 'complete');
  const result = await prepareEvidence({ ...f, estimatorLog: path.join(f.root, 'missing') });
  assert.equal(result.valid, false); assert.ok(result.missingOrEmpty.includes('p5-estimator-server.log'));
});
test('symlink cannot leak out-of-root evidence', async t => {
  const f = await fixture(t); await symlink('/etc/passwd', path.join(f.dir, 'escape'));
  await assert.rejects(prepareEvidence(f), /Symlink/);
});
test('unsafe newline names fail', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, 'unsafe\nname'), 'data');
  await assert.rejects(prepareEvidence(f), /Unsafe/);
});
test('unknown group cannot select arbitrary paths', async t => {
  const f = await fixture(t); await assert.rejects(prepareEvidence({ ...f, group: '../secret' }), /Unknown/);
});
test('output symlink is rejected without writing its destination', async t => {
  const f = await fixture(t); const other = path.join(f.root, 'other'); await mkdir(other);
  await symlink(other, path.join(f.root, 'ci-evidence-artifacts'));
  await assert.rejects(prepareEvidence(f), /output cannot/);
});
test('log-only early failure preserves diagnostics and missing manifest', async t => {
  const f = await fixture(t, 'estimator'); await rm(f.dir, { recursive: true });
  const log = path.join(f.root, 'server.log'); await writeFile(log, 'startup failed: synthetic test');
  const result = await prepareEvidence({ ...f, estimatorLog: log });
  assert.equal(result.valid, false);
  assert.equal(execFileSync('tar', ['-xOzf', result.archive, './p5-estimator-server.log']).toString(), 'startup failed: synthetic test');
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', result.archive, './manifest.json']));
  assert.ok(manifest.missingOrEmpty.includes('p5-verification/browser-results.json'));
});
test('each mobile report must be nonempty; commit-only is incomplete', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, 'tested-commit.txt'), 'synthetic-sha');
  assert.equal((await prepareEvidence(f)).valid, false);
  await writeFile(path.join(f.dir, 'verification.json'), '{}'); await writeFile(path.join(f.dir, 'server.log'), '');
  assert.deepEqual((await prepareEvidence(f)).missingOrEmpty, ['p5-mobile-seo-verification/server.log']);
  await writeFile(path.join(f.dir, 'server.log'), 'synthetic server started');
  assert.equal((await prepareEvidence(f)).valid, true);
});
test('empty estimator log is explicitly incomplete', async t => {
  const f = await fixture(t, 'estimator'); const log = path.join(f.root, 'server.log');
  await writeFile(log, ''); await writeFile(path.join(f.dir, 'browser-results.json'), '{}');
  assert.ok((await prepareEvidence({ ...f, estimatorLog: log })).missingOrEmpty.includes('p5-estimator-server.log'));
});
test('CLI fails incomplete evidence but exposes safe archive for always-upload', async t => {
  const f = await fixture(t); const output = path.join(f.root, 'outputs');
  const script = fileURLToPath(new URL('../scripts/prepare-ci-evidence.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, 'mobile'], { cwd: f.root, env: { PATH: process.env.PATH, GITHUB_OUTPUT: output }, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(await readFile(output, 'utf8'), 'archive_ready=true\n');
  assert.ok((await stat(path.join(f.root, 'ci-evidence-artifacts/mobile.tar.gz'))).size > 0);
});
test('workflow uploads exact nonhidden archive despite packaging validation failure', async () => {
  for (const [name, group] of [['p5-mobile-seo', 'mobile'], ['p5-estimator-verification', 'estimator']]) {
    const source = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    assert.ok(source.includes(`path: ci-evidence-artifacts/${group}.tar.gz`));
    assert.ok(source.includes("if: always() && steps.evidence.outputs.archive_ready == 'true'"));
    assert.ok(source.includes('run: node --test tests/ci-evidence.test.mjs'));
    assert.ok(!source.includes('continue-on-error'));
  }
});

test('hidden evidence is rejected rather than newly included in archive', async t => {
  const f = await fixture(t); await writeFile(path.join(f.dir, '.env'), 'synthetic-not-a-secret');
  await assert.rejects(prepareEvidence(f), /Unsafe/);
});

test('document archive requires every report and preserves complete bytes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cabinet-document-evidence-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'document-adapter-verification'); await mkdir(dir);
  const names = ['tested-commit.txt', 'adapter-integration.log', 'estimator-tests.log', 'build.log'];
  for (const name of names) await writeFile(path.join(dir, name), 'complete '+name+'\n');
  const result = await prepareEvidence({group:'document', root});
  assert.equal(result.valid, true); assert.equal(result.files.length, 4);
  for (const name of names) assert.equal(execFileSync('tar', ['-xOzf', result.archive, './document-adapter-verification/'+name]).toString(), 'complete '+name+'\n');
  await writeFile(path.join(dir, 'build.log'), '');
  const incomplete = await prepareEvidence({group:'document', root});
  assert.equal(incomplete.valid, false);
  assert.deepEqual(incomplete.missingOrEmpty, ['document-adapter-verification/build.log']);
  assert.equal(await readFile(path.join(dir, 'adapter-integration.log'), 'utf8'), 'complete adapter-integration.log\n');
});

 test('saved-page diagnostics are included without changing the original bytes', async t => {
 const f=await fixture(t,'estimator');const log=path.join(f.root,'server.log');const saved=path.join(f.root,'saved.log');
 await writeFile(log,'ordinary server');await writeFile(saved,'complete saved-page diagnostics');
 const r=await prepareEvidence({...f,estimatorLog:log,savedPageLog:saved});
 assert.equal(execFileSync('tar',['-xOzf',r.archive,'./p5-saved-page-server.log']).toString(),'complete saved-page diagnostics');
 assert.equal(await readFile(saved,'utf8'),'complete saved-page diagnostics');
 });
