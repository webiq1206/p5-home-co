import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { CONTACT_LEAD, CONTACT_NAP } from "../app/contact/content.ts";
import {
  PUBLIC_ADDRESS,
  PUBLIC_EMAIL,
  PUBLIC_PHONE_DISPLAY,
  SCHEMA_LEGAL_NAME,
  SCHEMA_TELEPHONE,
} from "../app/publicIdentity.ts";
import { serializeJsonLd, siteSchema } from "../app/structuredData.ts";
import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";

const VISIBLE_PHONE = "(208) 477-1169";
const SCHEMA_PHONE = "+1-208-477-1169";
const SCHEMA_EMAIL = "hello@p5homeco.com";
const PUBLIC_LOCALITY = "Meridian, ID 83646";
const VISIBLE_NAME = "P5 Home Co";
const CONTRACT_ANSWER = "Your contract is with P5 Home Co LLC, Idaho Registered Contractor #8381215. Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co are DBAs of P5 Home Co.";
const REGISTRATION_LLC = [
  "P5 Home Co LLC, Idaho Registered Contractor #8381215",
  "P5 Home Co LLC · Idaho Registered Contractor",
];

const PHONE_FORMS = new Set([
  VISIBLE_PHONE,
  SCHEMA_PHONE,
  "+12084771169",
  "tel:+12084771169",
  "sms:+12084771169",
]);

const PHONE_PATTERN = /(?:\+?1[\s().-]*)?\(?\s*208\s*\)?[\s().-]*477[\s().-]*1169/g;

test("the published name, phone, email and address stay on the citation", () => {
  assert.equal(PUBLIC_PHONE_DISPLAY, VISIBLE_PHONE);
  assert.equal(SCHEMA_TELEPHONE, SCHEMA_PHONE);
  assert.equal(PUBLIC_EMAIL, SCHEMA_EMAIL);
  assert.equal(PUBLIC_ADDRESS, PUBLIC_LOCALITY);
  assert.equal(SCHEMA_LEGAL_NAME, "P5 Home Co LLC");
  assert.equal(ESTIMATOR_BRAND.name, VISIBLE_NAME);
  assert.equal(ESTIMATOR_BRAND.phone, VISIBLE_PHONE);
  assert.equal(ESTIMATOR_BRAND.email, SCHEMA_EMAIL);
  const family = readFileSync("lib/familyBrand.ts", "utf8");
  assert.match(family, /name: "P5 Home Co"|name: 'P5 Home Co'/);
  assert.match(family, /copyrightName: 'P5 Home Co'/);
  assert.match(family, /display: PUBLIC_PHONE_DISPLAY/);
  assert.match(family, /email: PUBLIC_EMAIL/);

  const organization = siteSchema["@graph"][0];
  const website = siteSchema["@graph"][1];
  assert.equal(organization.name, VISIBLE_NAME);
  assert.equal(website.name, VISIBLE_NAME);
  assert.equal(organization.legalName, SCHEMA_LEGAL_NAME);
  assert.equal(organization.telephone, SCHEMA_PHONE);
  assert.equal(organization.contactPoint.telephone, SCHEMA_PHONE);
  assert.equal(organization.email, SCHEMA_EMAIL);
  assert.equal("streetAddress" in organization.address, false);
  assert.equal(
    `${organization.address.addressLocality}, ${organization.address.addressRegion} ${organization.address.postalCode}`,
    PUBLIC_LOCALITY,
  );
  assert.equal(organization.address.addressCountry, "US");

  const json = serializeJsonLd(siteSchema);
  assert.deepEqual(quoted(json, "telephone"), [SCHEMA_PHONE, SCHEMA_PHONE]);
  assert.deepEqual(quoted(json, "email"), [SCHEMA_EMAIL]);
  assert.equal(json.includes(`"name":"${VISIBLE_NAME}"`), true);
  assert.equal(json.includes('"legalName":"P5 Home Co LLC"'), true);
  assert.equal(json.includes("P5 Home Co."), false);
});

test("the contact page, vCard and llms files use that same citation", () => {
  assert.deepEqual(CONTACT_NAP, {
    name: VISIBLE_NAME,
    address: PUBLIC_LOCALITY,
    phone: VISIBLE_PHONE,
    email: SCHEMA_EMAIL,
  });
  // The hero paragraph carries neither the address nor the phone (owner copy rule); the NAP card
  // below and the line under the call button do, from the same constants.
  assert.equal(CONTACT_LEAD.includes(PUBLIC_LOCALITY), false);
  assert.equal(CONTACT_LEAD.includes(VISIBLE_PHONE), false);
  assert.equal(CONTACT_LEAD.includes(SCHEMA_EMAIL), true);

  const page = readFileSync("app/contact/page.tsx", "utf8");
  assert.match(page, /<p>\{PUBLIC_ADDRESS\}<\/p>/);
  assert.match(page, /className="contact-actions-phone">\s*<a href=\{PUBLIC_PHONE_TEL\}>\{PUBLIC_PHONE_DISPLAY\}<\/a>/);
  assert.match(page, /className="contact-nap"/);
  assert.match(page, /className="contact-nap-name">P5 Home Co</);
  assert.match(page, /\{PUBLIC_ADDRESS\}/);
  assert.match(page, /\{PUBLIC_PHONE_DISPLAY\}/);
  assert.match(page, /\{PUBLIC_EMAIL\}/);
  assert.equal(page.includes("PUBLIC_STREET"), false);

  const card = unfoldVCard(buildCard());
  assert.match(card, /^ORG:P5 Home Co$/m);
  assert.match(card, /^TEL;TYPE=WORK,VOICE:\+12084771169$/m);
  assert.match(card, /^EMAIL;TYPE=WORK:hello@p5homeco\.com$/m);
  assert.match(card, /^ADR;TYPE=WORK:;;;Meridian;ID;83646;USA$/m);
  assert.equal(card.includes(PUBLIC_LOCALITY), true);
  assert.equal(hasStreet(card), false);
  assert.match(readFileSync("app/contact.vcf/route.ts", "utf8"), /buildBusinessVCard/);

  for (const file of ["public/llms.txt", "public/llms-full.txt"]) {
    const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
    assert.equal(text.includes(PUBLIC_LOCALITY), true, file);
    assert.equal(text.includes(VISIBLE_PHONE), true, file);
    assert.equal(text.includes(SCHEMA_EMAIL), true, file);
    assert.equal(nameProblem(withoutRegistrationLlc(text)), null, file);
  }
});

test("legal, terms and contractor registration lines keep the legal name", () => {
  for (const file of [
    "app/legal/layout.tsx",
    "app/legal/privacy/page.tsx",
    "app/legal/terms/page.tsx",
    "app/legal/quickbooks-disconnect/page.tsx",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("P5 Home Co. LLC"), false, file);
    assert.equal(text.includes("P5 Home Co, LLC"), false, file);
  }
  for (const file of ["app/legal/layout.tsx", "app/legal/privacy/page.tsx", "app/legal/terms/page.tsx"]) {
    assert.equal(readFileSync(file, "utf8").includes("P5 Home Co LLC"), true, file);
  }
  const about = readFileSync("app/about/AboutClient.tsx", "utf8");
  assert.equal(about.includes("P5 Home Co LLC · Idaho Registered Contractor"), true);
  assert.equal(about.includes("P5 Home Co, Meridian, Idaho."), true);
  assert.equal(about.includes("P5 Home Co LLC, Meridian"), false);
  assert.equal(about.includes("are DBAs of P5 Home Co;"), true);
  assert.equal(about.includes("are DBAs of P5 Home Co LLC"), false);
  assert.equal(readFileSync("app/site.ts", "utf8").includes(CONTRACT_ANSWER), true);
  assert.equal(readFileSync("public/llms-full.txt", "utf8").includes(CONTRACT_ANSWER), true);
  assert.equal(readFileSync("app/site.ts", "utf8").includes("are DBAs of P5 Home Co LLC"), false);
  assert.equal(readFileSync("public/llms-full.txt", "utf8").includes("are DBAs of P5 Home Co LLC"), false);
});

test("rendered pages, schema and emails do not publish a street", () => {
  const hits: string[] = [];
  const seen = new Set<string>();
  const check = (label: string, text: string) => {
    if (!hasStreet(text) || seen.has(label)) return;
    seen.add(label);
    hits.push(label);
  };
  check("schema", serializeJsonLd(siteSchema));
  check("vcard", unfoldVCard(buildCard()));
  for (const file of repoTextFiles()) check(file, readFileSync(file, "utf8"));
  assert.deepEqual(hits, []);
});

test("visible pages show the phone as (208) 477-1169 and the name as P5 Home Co", () => {
  const phoneHits: string[] = [];
  for (const file of phoneFiles()) {
    const text = withoutComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(PHONE_PATTERN)) {
      if (!PHONE_FORMS.has(match[0])) phoneHits.push(`${file}: ${JSON.stringify(match[0])}`);
    }
  }
  assert.deepEqual(phoneHits, []);

  const nameHits: string[] = [];
  for (const file of nameFiles()) {
    const text = withoutRegistrationLlc(withoutComments(readFileSync(file, "utf8")));
    // The identity module may name the legal entity once. Registration lines are removed above.
    if (file === "app/publicIdentity.ts") {
      const legalNames = text.match(/P5 Home Co LLC/g) ?? [];
      if (legalNames.length !== 1) nameHits.push(`${file}: schema legalName count ${legalNames.length}`);
    } else {
      const problem = nameProblem(text);
      if (problem) nameHits.push(`${file}: ${JSON.stringify(problem)}`);
    }
  }
  assert.deepEqual(nameHits, []);

  const about = withoutComments(readFileSync("app/about/page.tsx", "utf8") + readFileSync("app/about/AboutClient.tsx", "utf8"));
  assert.equal(about.includes("P5 Home Co."), false);
  assert.equal(withoutRegistrationLlc(about).includes("P5 Home Co LLC"), false);
  assert.ok(nameFiles().includes("app/contact/page.tsx"));
  assert.ok(nameFiles().includes("app/site.ts"));
  assert.ok(phoneFiles().includes("app/not-found.tsx"));
});

function hasStreet(text: string): boolean {
  const name = ["Wa", "poot"].join("");
  const number = "4031" + " W";
  return text.toLowerCase().includes(name.toLowerCase()) || text.includes(number);
}

function repoTextFiles(): string[] {
  const found: string[] = [];
  const skip = new Set(["node_modules", ".git", ".next", "coverage"]);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name) || name.startsWith(".env")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|txt|md|mjs|html|json|vcf)$/.test(name) && name !== "package-lock.json") found.push(path);
    }
  };
  walk(".");
  return found;
}

function quoted(json: string, key: string): string[] {
  return [...json.matchAll(new RegExp(`"${key}":"([^"]*)"`, "g"))].map((match) => match[1]);
}

function withoutRegistrationLlc(text: string): string {
  return REGISTRATION_LLC.reduce((next, line) => next.split(line).join(""), text);
}

function nameProblem(text: string): string | null {
  const match = text.match(/P5 Home Co LLC|P5 Home Co, LLC|P5 Home Co\.\s*LLC|P5 Home Co\.\s+[a-z]/);
  return match ? match[0] : null;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function unfoldVCard(card: string): string {
  return card.replace(/\r\n[ \t]/g, "").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function buildCard(): string {
  const loaded = loadTs(fileURLToPath(new URL("../lib/vcard.ts", import.meta.url)));
  const build = loaded.buildBusinessVCard;
  assert.equal(typeof build, "function");
  return (build as () => string)();
}

function loadTs(entry: string): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const compile = (file: string) => ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const load = (file: string): Record<string, unknown> => {
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const exported: Record<string, unknown> = {};
    const commonjs = { exports: exported };
    cache.set(file, commonjs);
    const localRequire = (id: string) => {
      if (id.startsWith(".") || id.startsWith("@/")) return load(resolveImport(file, id));
      return require(id);
    };
    new Function("require", "exports", "module", compile(file))(localRequire, exported, commonjs);
    return commonjs.exports;
  };
  return load(entry);
}

function resolveImport(fromFile: string, id: string): string {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const base = id.startsWith("@/") ? join(root, id.slice(2)) : join(dirname(fromFile), id);
  const found = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
  assert.ok(found, `Missing module ${id} from ${fromFile}`);
  return found;
}

function nameFiles(): string[] {
  return [
    ...walk("app", new Set(["admin", "portal", "legal", "api", "lib"])),
    ...walk("components", new Set()),
    "public/llms.txt",
    "public/llms-full.txt",
    "lib/familyBrand.ts",
    "lib/vcard.ts",
  ];
}

function phoneFiles(): string[] {
  return [
    ...walk("app", new Set(["admin", "portal"])),
    ...walk("components", new Set()),
    "public/llms.txt",
    "public/llms-full.txt",
    "lib/familyBrand.ts",
    "lib/vcard.ts",
    "lib/p5/brand.ts",
  ];
}

function walk(dir: string, skip: Set<string>, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, skip, found);
    else if (/\.(ts|tsx|txt)$/.test(name)) found.push(path);
  }
  return found;
}
