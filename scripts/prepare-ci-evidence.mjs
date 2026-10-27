import { lstat, readdir, readFile, writeFile, appendFile, mkdir, rm, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REQUIRED = {
  document: ['document-adapter-verification/tested-commit.txt', 'document-adapter-verification/adapter-integration.log', 'document-adapter-verification/estimator-tests.log', 'document-adapter-verification/build.log'],
  mobile: ['p5-mobile-seo-verification/verification.json', 'p5-mobile-seo-verification/tested-commit.txt', 'p5-mobile-seo-verification/server.log'],
  estimator: ['p5-verification/browser-results.json', 'p5-verification/mobile-navigation.json', 'p5-verification/intent/results-chromium.json', 'p5-verification/intent/results-webkit.json', 'p5-verification/exit/results-chromium.json', 'p5-verification/exit/results-webkit.json', 'p5-verification/admin-component-results.json', 'p5-estimator-server.log'],
};
const LIMIT = 64 * 1024 * 1024;
const GROUPS = {
  document: ['document-adapter-verification'],
  mobile: ['p5-mobile-seo-verification'],
  estimator: ['p5-verification', '/tmp/p5-estimator-server.log'],
};

// CLI limits are fixed. Smaller limits are injectable only for offline tests.
export async function prepareEvidence({ group, root = process.cwd(), maxBytes = LIMIT, maxFiles = 10000, estimatorLog = '/tmp/p5-estimator-server.log', savedPageLog }) {
  if (!Object.hasOwn(GROUPS, group)) throw new Error('Unknown evidence group');
  root = await realpath(root);
  const out = path.join(root, 'ci-evidence-artifacts');
  await mkdir(out, { recursive: true });
  if ((await lstat(out)).isSymbolicLink()) throw new Error('Evidence output cannot be a symlink');
  const archive = path.join(out, `${group}.tar.gz`);
  const staging = path.join(out, `${group}-staging`);
  // Remove only our own prior generated output, never original evidence.
  await rm(archive, { force: true });
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging);
  const files = [];
  let total = 0;
  async function collect(source, name) {
    if (/[\r\n]/.test(name) || name.split('/').some(p => p.startsWith('.'))) throw new Error('Unsafe evidence path');
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Symlink evidence rejected: ${name}`);
    if (stat.isDirectory()) {
      for (const child of (await readdir(source)).sort()) await collect(path.join(source, child), `${name}/${child}`);
      return;
    }
    if (!stat.isFile()) throw new Error(`Non-file evidence rejected: ${name}`);
    if (files.length >= maxFiles || total + stat.size > maxBytes) throw new Error('Evidence exceeds raw size or file-count limit');
    const bytes = await readFile(source);
    if (total + bytes.length > maxBytes) throw new Error('Evidence grew beyond raw size limit');
    total += bytes.length;
    const dest = path.join(staging, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  try {
    const dir = GROUPS[group][0];
    async function collectIfPresent(source, name) {
      try { await lstat(source); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      await collect(source, name);
    }
    await collectIfPresent(path.join(root, dir), dir);
    if (group === 'estimator') await collectIfPresent(estimatorLog, 'p5-estimator-server.log');
    if (group === 'estimator' && savedPageLog) await collectIfPresent(savedPageLog, 'p5-saved-page-server.log');
    const required = group === 'estimator' && savedPageLog ? [...REQUIRED[group], 'p5-saved-page-server.log'] : REQUIRED[group];
    const missing = required.filter(name => !files.some(file => file.path === name && file.bytes > 0));
    const valid = missing.length === 0;
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ group, valid, missingOrEmpty: missing, totalBytes: total, files }, null, 2) + '\n');
    const temporary = path.join(out, `${group}.pending.tar.gz`);
    try {
      execFileSync('tar', ['-czf', temporary, '-C', staging, '.'], { stdio: 'pipe' });
      if ((await lstat(temporary)).size > maxBytes) throw new Error('Evidence archive exceeds size limit');
      await rename(temporary, archive);
    } finally { await rm(temporary, { force: true }); }
    return { archive, valid, missingOrEmpty: missing, totalBytes: total, files };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareEvidence({ group: process.argv[2], savedPageLog: process.argv[3] === 'saved-page' ? '/tmp/p5-saved-page-server.log' : undefined }).then(async result => {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'archive_ready=true\n');
    console.log(JSON.stringify({ archive: result.archive, valid: result.valid, missingOrEmpty: result.missingOrEmpty, bytes: result.totalBytes, files: result.files.length }));
    if (!result.valid) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
