import {randomBytes} from 'node:crypto';
import {intakeReference,type IntakeSnapshot} from './intakeContract.ts';
import type {IntakeQuery} from './intakeStore.ts';
import type {IntakeSite} from './intakePolicy.ts';

const prefixes:Record<IntakeSite,string>={p5:'P',construction:'C',remodeling:'R',handyman:'H',cabinet:'B'};
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newIntakeReference(site:IntakeSite){
 let value=randomBytes(5).readUIntBE(0,5),code='';
 for(let i=0;i<8;i++){code=alphabet[value%32]+code;value=Math.floor(value/32);}
 return `P5-${prefixes[site]}-${code}`;
}

/** Database uniqueness handles concurrent submissions and random collisions.
 * A reservation is metadata, not an accepted request: acceptance still requires
 * the immutable snapshot and downstream work to commit in intakeStore.save.
 * Submitted projects cannot transfer between sites (intakeTransferStore.seal),
 * so each site's prefix establishes a separate allocation namespace. */
export async function reserveIntakeReference(query:IntakeQuery,projectId:string,site:IntakeSite,mint=()=>newIntakeReference(site)):Promise<string>{
 const read=async()=>{const [row]=await query('SELECT reference FROM p5_project_references WHERE project_id=$1',[projectId]);return row?.reference as string|undefined;};
 const existing=await read();if(existing)return existing;
 const [prior]=await query("SELECT payload->'snapshot' AS snapshot FROM p5_estimator_work WHERE work_key='intake-submission-v1' AND payload->'snapshot'->>'projectId'=$1 LIMIT 1",[projectId]);
 const legacy=prior?.snapshot?intakeReference(projectId,(prior.snapshot as IntakeSnapshot).reference):undefined;
 for(let attempt=0;attempt<8;attempt++){
  const candidate=legacy||mint();
  if(!/^P5-(?:[PCRHB]-[2-9A-HJ-NP-Z]{8}|[A-F0-9]{10})$/.test(candidate))throw Error('request-reference-invalid');
  const [inserted]=await query('INSERT INTO p5_project_references(project_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',[projectId,candidate]);
  if(inserted?.reference)return inserted.reference;
  const winner=await read();if(winner)return winner;
  // Never silently rename a historical reference or overwrite another project.
  if(legacy)throw Error('request-reference-conflict');
 }
 throw Error('request-reference-unavailable');
}
