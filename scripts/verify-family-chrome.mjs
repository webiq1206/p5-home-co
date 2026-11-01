// Family chrome guard. SHARED FILE (lib/family/manifest.json).
//
// The header, menu, bottom bar, footer, photo hero, proof strip, skip link and
// their tokens are one implementation copied byte-identical into every P5 Home Co
// family site. A brand changes how they look only through lib/familyBrand.ts.
// This check fails the build when:
//   1. a shared file listed in lib/family/manifest.json differs from its recorded
//      sha256 (it was edited in one site only), or is missing;
//   2. a file in a shared location is not listed (it would escape the check);
//   3. a shared file carries a brand: a family company name, domain or brand
//      accent colour, or an import from anything but React, Next, the brand
//      config and the other shared files.
//
//   node scripts/verify-family-chrome.mjs           check (runs in prebuild)
//   node scripts/verify-family-chrome.mjs --write   re-record hashes, only in the
//                                                   source repository named in the manifest
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'lib/family/manifest.json');
const write = process.argv.includes('--write');

/** Where shared files live. Anything here must be in the manifest. */
const SHARED_LOCATIONS = [
  { dir: 'components/family', match: (name) => /\.(tsx?|css)$/.test(name) },
  { dir: 'styles', match: (name) => /^family-.*\.css$/.test(name) },
  { dir: 'lib/family', match: (name) => /\.ts$/.test(name) },
  { dir: 'scripts', match: (name) => name === 'verify-family-chrome.mjs' },
];

/** Brand facts that must never appear in a shared file. */
const BRAND_MARKERS = [
  /Boise (Remodeling|Construction|Handyman|Cabinet|ADU) Co/i,
  /P5 Home Co/i,
  /boise(remodeling|construction|handyman|cabinet)\.co/i,
  /p5homeco\.com/i,
  /\(208\)|208[-. ]?477|2084771169/,
  /Wapoot|Meridian/i,
  /#(7d9479|4d6249|c48d3f|78531e|659b9a|356463|c56b4a|92472c|ceb391|a58c72|705a45|c97c99)\b/i,
];
/** Shared files may import only these. */
const ALLOWED_IMPORT = /^(react|react-dom|next\/(link|image|navigation)|node:[a-z]+|@\/lib\/familyBrand|@\/lib\/family\/types|\.\/[A-Za-z]+)$/;

const hash = (file) => createHash('sha256').update(readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

function sharedFilesOnDisk() {
  return SHARED_LOCATIONS.flatMap(({ dir, match }) => {
    const absolute = path.join(root, dir);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && match(entry.name))
      .map((entry) => path.posix.join(dir, entry.name));
  }).sort();
}

function contentProblems(file) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const problems = [];
  // This script names the markers it looks for; skip the marker check on itself.
  if (file !== 'scripts/verify-family-chrome.mjs') {
    for (const marker of BRAND_MARKERS) if (marker.test(source)) problems.push(`${file} contains brand-specific text ${marker}`);
  }
  if (/\.(tsx?|mjs)$/.test(file)) {
    for (const match of source.matchAll(/(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      if (!ALLOWED_IMPORT.test(match[1])) problems.push(`${file} imports ${match[1]}`);
    }
  }
  if (source.includes(String.fromCharCode(0x2014))) problems.push(`${file} contains an em dash`);
  return problems;
}

if (!existsSync(manifestPath)) {
  console.error('verify-family-chrome: lib/family/manifest.json is missing.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const repoName = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name;
const onDisk = sharedFilesOnDisk();

if (write) {
  if (manifest.source !== repoName) {
    console.error(`verify-family-chrome: hashes are recorded only in ${manifest.source}; this is ${repoName}. Make the change there and sync it here.`);
    process.exit(1);
  }
  const problems = onDisk.flatMap(contentProblems);
  if (problems.length) {
    console.error('verify-family-chrome: refusing to record shared files that carry a brand:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  manifest.files = Object.fromEntries(onDisk.map((file) => [file, hash(file)]));
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`verify-family-chrome: recorded ${onDisk.length} shared files.`);
  process.exit(0);
}

const listed = Object.keys(manifest.files ?? {});
const changed = [];
const missing = [];
for (const file of listed) {
  if (!existsSync(path.join(root, file))) missing.push(file);
  else if (hash(file) !== manifest.files[file]) changed.push(file);
}
const unlisted = onDisk.filter((file) => !listed.includes(file));
const problems = listed.filter((file) => existsSync(path.join(root, file))).flatMap(contentProblems);
if (!existsSync(path.join(root, 'lib/familyBrand.ts')) || !/export const FAMILY_BRAND\b/.test(readFileSync(path.join(root, 'lib/familyBrand.ts'), 'utf8'))) {
  problems.push('lib/familyBrand.ts must exist and export FAMILY_BRAND');
}

if (changed.length || missing.length || unlisted.length || problems.length) {
  if (changed.length) console.error(`Changed in this site only (make the change in ${manifest.source}, then sync):\n  ${changed.join('\n  ')}`);
  if (missing.length) console.error(`Missing shared files:\n  ${missing.join('\n  ')}`);
  if (unlisted.length) console.error(`Files in a shared location but not in lib/family/manifest.json:\n  ${unlisted.join('\n  ')}`);
  if (problems.length) console.error(`Shared files must stay brand-agnostic:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`verify-family-chrome: ${listed.length} shared files match ${manifest.source}.`);
