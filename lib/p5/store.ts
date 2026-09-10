import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { query } from "./database";
import type { ReviewedScope, ScopeAnswers, ScopeExtraction, ScopeUpload } from "./scope.ts";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export class DraftError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status=status; } }
export interface Draft {
  id: string; revision: number; status: "draft" | "submitted"; updatedAt: string;
  text: string; answers: ScopeAnswers; extraction: ScopeExtraction | null;
  reviewed: ReviewedScope | null; uploads: ScopeUpload[];
  contact: { name: string; email: string; phone: string }; brand: string;
}
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = (async () => {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS p5_estimator_drafts (id uuid PRIMARY KEY, key_hash text NOT NULL, brand text NOT NULL, revision integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', payload jsonb NOT NULL DEFAULT '{}', internal_estimate jsonb, customer_estimate jsonb, submitted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS p5_estimator_files (id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id), name text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL, data_base64 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(draft_id, sha256))`,
      `CREATE TABLE IF NOT EXISTS p5_estimator_outbox (id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES p5_estimator_drafts(id), revision integer NOT NULL, destination text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, provider_id text, last_error text, locked_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, UNIQUE(draft_id, revision, destination))`,
      `CREATE INDEX IF NOT EXISTS p5_estimator_outbox_due ON p5_estimator_outbox(status,next_attempt_at)`,
      `CREATE TABLE IF NOT EXISTS p5_estimator_policy (id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
    ]) await query(statement);
  })().catch(error => {schemaReady=null;throw error;});
  return schemaReady;
}
export function draftCredentials(request: Request) {
  const id = request.headers.get("x-p5-draft-id") || "";
  const key = request.headers.get("x-p5-draft-key") || "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) || !/^[a-f0-9]{64}$/i.test(key)) throw new DraftError("Invalid draft credentials",401);
  return {id,key};
}
async function rowFor(id: string, key: string) {
  await ensureSchema();
  const [row]=await query("SELECT * FROM p5_estimator_drafts WHERE id=$1",[id]);
  if (!row) return null;
  const a=Buffer.from(String(row.key_hash));const b=Buffer.from(hash(key));
  if(a.length!==b.length || !timingSafeEqual(a,b)) throw new DraftError("Draft not found",404);
  return row;
}
export async function readDraft(id: string,key: string): Promise<Draft|null> {
  const row=await rowFor(id,key);if(!row)return null;
  const files=await query("SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at",[id]);
  return {id,revision:row.revision,status:row.status,updatedAt:new Date(row.updated_at).toISOString(),brand:row.brand,
    text:"",answers:{},extraction:null,reviewed:null,contact:{name:"",email:"",phone:""},...row.payload,
    uploads:files.map(f=>({id:f.id,name:f.name,type:f.mime_type,size:f.size_bytes,sha256:f.sha256,status:"stored"})),
  };
}
export async function saveDraft(id: string,key: string,brand: string,payload: Omit<Draft,"id"|"brand"|"revision"|"status"|"updatedAt"|"uploads">,expectedRevision: number): Promise<Draft> {
  const existing=await rowFor(id,key);
  if(existing?.status==="submitted")throw new DraftError("This submission is already saved. Start a new revision to change the scope.",409);
  if(existing && existing.revision!==expectedRevision)throw new DraftError("This draft changed in another tab. Reload the saved version before overwriting it.",409);
  let result;
  if(!existing)result=await query("INSERT INTO p5_estimator_drafts(id,key_hash,brand,payload,revision) VALUES($1,$2,$3,$4::jsonb,1) ON CONFLICT DO NOTHING RETURNING id",[id,hash(key),brand,JSON.stringify(payload)]);
  else result=await query("UPDATE p5_estimator_drafts SET payload=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 AND status='draft' RETURNING id",[JSON.stringify(payload),id,expectedRevision]);
  if(!result.length)throw new DraftError("The draft changed while saving. Reload before retrying.",409);
  return (await readDraft(id,key))!;
}
export async function saveUpload(id:string,key:string,file:{name:string;type:string;data:Buffer}):Promise<ScopeUpload> {
  const draft=await rowFor(id,key);if(!draft)throw new DraftError("Save the draft before uploading.",404);
  if(draft.status!=="draft")throw new DraftError("This estimate has already been submitted.",409);
  const digest=hash(file.data);
  const duplicate=await query("SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 AND sha256=$2",[id,digest]);
  const fileId=duplicate[0]?.id||randomUUID();
  if(!duplicate.length)await query("INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(draft_id,sha256) DO NOTHING",[fileId,id,file.name,file.type,file.data.length,digest,file.data.toString("base64")]);
  const [stored]=await query("SELECT id,name,mime_type,size_bytes,sha256 FROM p5_estimator_files WHERE draft_id=$1 AND sha256=$2",[id,digest]);
  return {id:stored.id,name:stored.name,type:stored.mime_type,size:stored.size_bytes,sha256:stored.sha256,status:"stored"};
}
export async function readUploads(id:string,key:string) {
  if(!await rowFor(id,key))throw new DraftError("Draft not found",404);
  const rows=await query("SELECT id,name,mime_type,data_base64 FROM p5_estimator_files WHERE draft_id=$1 ORDER BY created_at",[id]);
  return rows.map(row=>({id:row.id as string,name:row.name as string,type:row.mime_type as string,data:Buffer.from(row.data_base64,"base64")}));
}
