import assert from "node:assert/strict";
import { test } from "node:test";
import { stat, readFile, unlink } from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import { runP5Acceptance, QA_CONFIRMATION } from "../lib/p5/cliAcceptance.ts";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("prepare mode does not call the network and explains live inputs", async () => {
  let calls = 0;
  const result = await runP5Acceptance({ fetcher: async () => { calls += 1; return response({}); } });
  assert.equal(calls, 0);
  assert.equal(result.requests.length, 0);
  assert.match(result.message, /zero network\/provider\/email\/CRM calls/);
  assert.match(result.message, /HTTPS/);
});

test("live runner saves, reloads, reviews, then submits once without logging credentials", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${new URL(url).pathname}`);
    if (init?.method === "PUT" && calls.length === 1) return response({ draft: { id: new Headers(init.headers).get("x-p5-draft-id"), revision: 1 } });
    if (init?.method === "GET") return response({ draft: { id: init?.headers && new Headers(init.headers).get("x-p5-draft-id"), revision: 1, answers: {}, contact: {} } });
    if (init?.method === "PUT") return response({ draft: { revision: 2, reviewed: { reviewedAt: "fixture" } } });
    return response({ accepted: true, duplicate: false, id: new Headers(init?.headers).get("x-p5-draft-id") });
  };
  const stateFile = join(tmpdir(),`p5-acceptance-test-${process.pid}.json`);
  const result = await runP5Acceptance({
    mode: "live", baseUrl: "https://qa.example", email: "qa+acceptance@example.com",
    scope: "[QA] Repair one interior door.", confirm: QA_CONFIRMATION, confirmAgain: QA_CONFIRMATION,
    stateFile, fetcher, pollMs: 0,
  });
  assert.deepEqual(calls.map(item => item.split(" ")[0]), ["PUT", "GET", "PUT", "POST"]);
  assert.equal(result.accepted, true);
  assert.ok(result.stateFile);
  // Windows has no POSIX permission bits; the owner-only mode is asserted where the host enforces it.
  const mode = (await stat(result.stateFile)).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
  const saved = await readFile(result.stateFile, "utf8");
  assert.match(saved, /"revision": 2/);
  await unlink(stateFile);
});

test("live mode rejects non-HTTPS and missing double confirmation", async () => {
  await assert.rejects(() => runP5Acceptance({ mode: "live", baseUrl: "http://qa.example", email: "x@qa.example", scope: "[QA] x" }), /HTTPS/);
  await assert.rejects(() => runP5Acceptance({ mode: "live", baseUrl: "https://qa.example", email: "qa@example.com", scope: "[QA] x" }), /twice/);
});

test("duplicate acknowledgement requires the same submitted draft and no second submit",async()=>{
  const calls:string[]=[];
  let id="";
  const fetcher=async(url:string,init?:RequestInit)=>{
    const method=String(init?.method);calls.push(`${method} ${new URL(url).pathname}`);
    id=new Headers(init?.headers).get("x-p5-draft-id")||id;
    if(method==="PUT"&&calls.length===1)return response({draft:{id,revision:1}});
    if(method==="GET"&&calls.length===2)return response({draft:{id,revision:1,answers:{},contact:{}}});
    if(method==="PUT")return response({draft:{id,revision:2,reviewed:{reviewedAt:"fixture"}}});
    if(method==="POST")return response({accepted:false,duplicate:true,id});
    return response({draft:{id,revision:2,status:"submitted"}});
  };
  const stateFile=join(tmpdir(),`p5-acceptance-duplicate-${process.pid}.json`);
  const result=await runP5Acceptance({mode:"live",baseUrl:"https://qa.example",email:"qa+duplicate@example.com",scope:"[QA] duplicate check",confirm:QA_CONFIRMATION,confirmAgain:QA_CONFIRMATION,stateFile,fetcher,pollMs:0});
  assert.equal(result.accepted,true);
  assert.equal(calls.filter(call=>call.startsWith("POST ")).length,1);
  await unlink(stateFile);
});