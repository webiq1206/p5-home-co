import type {IntakeQuery} from './intakeStore.ts';

export const INTAKE_TRANSFER_STATUSES=['intake-transferring','intake-importing','intake-transferred'] as const;
export const isIntakeTransferStatus=(status:unknown)=>(INTAKE_TRANSFER_STATUSES as readonly unknown[]).includes(status);
export const TRANSFER_HOLD_MESSAGE='This project is being continued with another P5 business. Resume the saved transfer before making changes; your original details and files are retained.';
export async function hasIntakeTransferHold(id:string,query:IntakeQuery){
 const [draft]=await query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[id]);return isIntakeTransferStatus(draft?.status);
}
/** The final registration and a transfer freeze serialize on the same draft row. */
export const REGISTER_DRAFT_UPLOAD_SQL=`WITH owned AS (
 SELECT id FROM p5_estimator_drafts WHERE id=$2 AND status='draft' FOR UPDATE
) INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key)
 SELECT $1,id,$3,$4,$5,$6,$7,$8,$9 FROM owned ON CONFLICT(draft_id,sha256) DO NOTHING`;
