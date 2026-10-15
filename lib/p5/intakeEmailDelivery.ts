import {renderIntakePdf} from './intakePdf.ts';
import {intakeReference,type IntakeSnapshot} from './intakeContract.ts';
import type {IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';
import {intakeFileLink,verifiedIntakeFile} from './intakeFileAccess.ts';
import {renderIntakeEmail,type IntakeEmailFile} from './intakeEmail.ts';
import type {IntakeQuery} from './intakeStore.ts';

/** 12 MiB raw leaves room for MIME/base64 expansion and the full project record
 * below the existing transports' message limits. Overflow always has a scoped link. */
export const INTAKE_ATTACHMENT_BYTES=12*1024*1024;
export async function prepareIntakeEmail(s:IntakeSnapshot,envelope:IntakeDeliveryEnvelope,deps:{query:IntakeQuery;readBytes:(row:Record<string,unknown>)=>Promise<Uint8Array>;secret:()=>string;now?:()=>number}){
 if(!envelope.email||envelope.channel==='crm')throw Error('payload-review');
 const pdf=await renderIntakePdf(s);
 if(pdf.byteLength>2*1024*1024)throw Error('payload-review');
 const email={...envelope.email,attachments:[{filename:`${intakeReference(s.projectId,s.reference)}-project-request.pdf`,base64:pdf.toString('base64'),contentType:'application/pdf'}]},files:IntakeEmailFile[]=[];
 const secret=s.scope.uploads.length?deps.secret():'';
 let used=email.attachments.reduce((sum,a)=>sum+Buffer.from(a.base64,'base64').byteLength,0);
 for(const file of s.scope.uploads){
  // Validate every retained original before any message can be attempted.
  const bytes=await verifiedIntakeFile(s,file,deps),attached=used+bytes.byteLength<=INTAKE_ATTACHMENT_BYTES;
  const url=intakeFileLink(s,file,envelope.channel,secret,deps.now?.());
  files.push({name:file.name,size:file.size,url,attached});
  if(attached){email.attachments.push({filename:file.name.replace(/[\r\n\0]/g,'_'),base64:Buffer.from(bytes).toString('base64'),contentType:file.type});used+=bytes.byteLength;}
 }
 Object.assign(email,renderIntakeEmail(s,envelope.channel==='team',files));
 if(Buffer.byteLength(email.text)+Buffer.byteLength(email.html||'')>2*1024*1024)throw Error('payload-review');
 return {...envelope,email};
}
