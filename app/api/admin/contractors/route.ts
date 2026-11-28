import { DraftError } from "../../../../lib/p5/store.ts";
import { json, limitedBody, protectRequest } from "../../../../lib/p5/http.ts";
import { ContractorStoreError, importContractorRoster, listContractors, requireContractorActor, saveContractor } from "../../../lib/contractors/store.ts";
import { isRecord } from "../../../lib/contractors/identity.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof ContractorStoreError || error instanceof DraftError) return json({error:error.message},error.status);
  // Do not put payloads, contact data or unhandled SQL error details in logs or responses.
  return json({error:"Contractor directory is temporarily unavailable. Existing records are unchanged."},503);
}
async function body(request:Request, max:number):Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json") {
    throw new ContractorStoreError("Expected a JSON request.",415);
  }
  const bytes=await limitedBody(request,max);
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
  catch { throw new ContractorStoreError("Invalid JSON request.",400); }
}

export async function GET() {
  try {
    await requireContractorActor();
    return json({contractors:await listContractors()});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    protectRequest(request);
    const actor=await requireContractorActor({write:true});
    const mode=new URL(request.url).searchParams.get("import");
    if (mode!==null) {
      if (mode!=="preview" && mode!=="commit") throw new ContractorStoreError("Unknown import operation.",400);
      const payload=await body(request,4*1024*1024);
      if (!isRecord(payload) || !Array.isArray(payload.rows)) throw new ContractorStoreError("Provide a contractor rows array.",400);
      const token=mode==="commit" ? payload.token : undefined;
      if (mode==="commit" && (typeof token!=="string" || !/^[a-f0-9]{64}$/.test(token))) throw new ContractorStoreError("Preview this import first.",400);
      return json(await importContractorRoster(payload.rows,actor.id,typeof token==="string" ? token : undefined));
    }
    return json({contractor:await saveContractor(await body(request,128*1024),actor.id)});
  } catch (error) { return failure(error); }
}
