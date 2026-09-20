import { randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ESTIMATOR_BRAND as brand } from "./brand.ts";

export type AcceptanceMode = "prepare" | "live";
export type RunnerFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface AcceptanceOptions {
  mode?: AcceptanceMode;
  baseUrl?: string;
  email?: string;
  scope?: string;
  /** Scope answers saved with the draft. Defaults to the smallest valid set for this brand. */
  answers?: Record<string, string>;
  confirm?: string;
  confirmAgain?: string;
  stateFile?: string;
  timeoutMs?: number;
  pollMs?: number;
  fetcher?: RunnerFetch;
  now?: () => number;
  output?: (message: string) => void;
}
export interface AcceptanceState {
  id: string;
  key: string;
  revision: number;
  text: string;
  email: string;
  createdAt: string;
}
export interface AcceptanceResult {
  mode: AcceptanceMode;
  stateFile?: string;
  state?: Omit<AcceptanceState, "key">;
  accepted?: boolean;
  requests: string[];
  message: string;
}

const QA_CONFIRMATION = "I CONFIRM QA LIVE ACCEPTANCE";
const QA_EMAIL = /^(?:qa(?:[+._-][^@\s]+)?|[^@\s]+\.qa)@[^@\s]+$/i;
const pathFor = (file?: string) => {
  const root=resolve(tmpdir());
  const candidate=resolve(file||join(root,`p5-acceptance-${randomUUID()}.json`));
  const within=relative(root,candidate);
  if(within.startsWith("..")||isAbsolute(within))throw new Error("Acceptance credential state must stay in the operating system temporary directory.");
  return candidate;
};

function requireLive(options: AcceptanceOptions, scope: string, email: string, base: URL) {
  if (base.protocol !== "https:") throw new Error("Live mode requires an HTTPS base URL.");
  if (!QA_EMAIL.test(email)&&!(process.env.SYNTHETIC_QA_EMAIL_ALLOWLIST||'').split(',').map(value=>value.trim().toLowerCase()).includes(email.trim().toLowerCase())) throw new Error("Live mode requires a clearly marked QA email under a .qa address.");
  if (!scope.includes("[QA]")) throw new Error("Live mode requires a clearly marked [QA] scope.");
  if (options.confirm !== QA_CONFIRMATION || options.confirmAgain !== QA_CONFIRMATION) {
    throw new Error("Live mode requires the exact confirmation twice.");
  }
}

async function saveState(file: string, state: AcceptanceState) {
  await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}
async function loadState(file: string): Promise<AcceptanceState> {
  const state = JSON.parse(await readFile(file, "utf8")) as AcceptanceState;
  if (!state.id || !state.key || !Number.isInteger(state.revision)) throw new Error("Invalid acceptance state file.");
  return state;
}
function headers(state: AcceptanceState) {
  return { "content-type": "application/json", "x-p5-draft-id": state.id, "x-p5-draft-key": state.key };
}
async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202 && response.status !== 422) {
    throw new Error(`Acceptance endpoint returned HTTP ${response.status}.`);
  }
  return body as Record<string, any>;
}

/**
 * Private acceptance runner. Prepare is deliberately side-effect free. Live uses
 * only the customer draft and submit endpoints and never emits credentials.
 */
export async function runP5Acceptance(options: AcceptanceOptions = {}): Promise<AcceptanceResult> {
  const mode = options.mode || "prepare";
  const scope = options.scope || "[QA] Acceptance scope: repair one interior door.";
  const email = options.email || "p5-acceptance@qa.example";
  const stateFile = pathFor(options.stateFile);
  const output = options.output || (() => undefined);
  if (mode === "prepare") {
    const message = "Prepare mode made zero network/provider/email/CRM calls. Supply an HTTPS base URL, a .qa email, a [QA] scope, and the live confirmation twice to run.";
    output(message);
    return { mode, requests: [], message };
  }
  const base = new URL(options.baseUrl || "");
  requireLive(options, scope, email, base);
  const fetcher = options.fetcher || fetch;
  const state: AcceptanceState = { id: randomUUID(), key: randomBytes(32).toString("hex"), revision: 0, text: scope, email, createdAt: new Date().toISOString() };
  const requests: string[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    requests.push(`${method} ${path}`);
    const response = await fetcher(new URL(path, base).toString(), { method, headers: headers(state), body: body === undefined ? undefined : JSON.stringify(body) });
    return jsonResponse(response);
  };
  const answers = options.answers || ((brand.id as string) === "handyman"
    ? { service: "handyman", location: "Boise, Idaho", taskList: scope }
    : { service: String(brand.defaultService || brand.services[0]), location: "Boise, Idaho" });
  const saved = await call("PUT", "/api/p5-estimator/draft", { revision: 0, text: scope, answers, contact: { name: "[QA] Acceptance", email, phone: "" } });
  state.revision = Number(saved.draft?.revision);
  if (saved.draft?.id !== state.id||state.revision!==1) throw new Error("Draft save did not confirm the expected identity and first revision.");
  await saveState(stateFile, state);
  const reloaded = await loadState(stateFile);
  const initial = await call("GET", "/api/p5-estimator/draft");
  if (initial.draft?.id !== reloaded.id) throw new Error("Reloaded draft identity changed.");
  if (initial.draft?.revision !== reloaded.revision) throw new Error("Reloaded draft revision changed.");
  const reviewed = await call("PUT", "/api/p5-estimator/draft", { revision: reloaded.revision, text: reloaded.text, answers: initial.draft?.answers || {}, contact: initial.draft?.contact, reviewed: true });
  state.revision = Number(reviewed.draft?.revision);
  if (!Number.isInteger(state.revision)||state.revision!==reloaded.revision+1||!reviewed.draft?.reviewed) throw new Error("Review save did not confirm the expected revision.");
  await saveState(stateFile, state);
  const timeout = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 2_000;
  const deadline = (options.now || Date.now)() + timeout;
  let accepted = false;
  while ((options.now || Date.now)() < deadline) {
    let result: Record<string, any>;
    try {
      result = await call("POST", "/api/p5-estimator/submit", { revision: state.revision, background: true });
    } catch (error) {
      const status = await call("GET", "/api/p5-estimator/draft");
      if (status.draft?.status === "submitted") { accepted = true; break; }
      throw new Error(`Submit state is ambiguous; no further requests will be made. ${error instanceof Error ? error.message : ""}`.trim());
    }
    if (result.accepted === true) {
      if(result.id!==state.id)throw new Error("Submission acknowledgement did not match the QA draft.");
      accepted = true;break;
    }
    if (result.duplicate === true) {
      if(result.id!==state.id)throw new Error("Duplicate acknowledgement did not match the QA draft.");
      const status=await call("GET","/api/p5-estimator/draft");
      if(status.draft?.id!==state.id||status.draft?.revision!==state.revision||status.draft?.status!=="submitted")throw new Error("Duplicate acknowledgement was not confirmed by the submitted QA draft.");
      accepted=true;break;
    }
    if (result.pending === true) { await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - (options.now || Date.now)())))); continue; }
    if (result.pricingReviewRequired) throw new Error("QA acceptance stopped because pricing requires review.");
    const status = await call("GET", "/api/p5-estimator/draft");
    if (status.draft?.status === "submitted") { accepted = true; break; }
    throw new Error("QA acceptance returned an unknown committed state; no further requests will be made.");
  }
  if (!accepted) {
    const status = await call("GET", "/api/p5-estimator/draft");
    if (status.draft?.status === "submitted") accepted = true;
    else throw new Error("Acceptance timed out with an ambiguous draft state; no further requests will be made.");
  }
  const { key: _neverLogCredential, ...safeState } = state;
  return { mode, stateFile, state: safeState, accepted, requests, message: "QA draft accepted." };
}

export { QA_CONFIRMATION };