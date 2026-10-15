import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,rgb,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {INTAKE_SITES,INTAKE_RECIPIENTS} from './intakePolicy.ts';
import {intakeReference,type IntakeSnapshot} from './intakeContract.ts';
import {intakeContactLabel,intakeChoiceLabel,intakeSavedAt} from './intakeDisplay.ts';
import {SCOPE_FIELDS} from './scope.ts';
import {wrap,clean,hex} from './estimatePdf.ts';

/** A customer-safe projection of the immutable accepted request. Never include
 * extraction, private notes, provider data, internal costs or authenticated URLs. */
export function intakePdfSections(s:IntakeSnapshot):[string,string][] {
 const answers=Object.entries(s.scope.answers).filter(([,v])=>v?.trim()).map(([k,v])=>{
  const field=Object.hasOwn(SCOPE_FIELDS,k)?SCOPE_FIELDS[k as keyof typeof SCOPE_FIELDS]:null;
  return `${field?.label||k}: ${field?.kind==='choice'?intakeChoiceLabel(k,v||''):v}`;
 });
 return [
  ['What happens next','Your project request has been received. The team will review your scope and files before preparing an estimate. We will use your preferred contact method if more information or a site visit is needed. This is a project request, not a priced estimate.'],
  ['Your contact details',[s.contact.name,s.contact.email,s.contact.phone,`Preferred contact: ${intakeContactLabel(s.contact.preferredContact)}`].filter(Boolean).join('\n')],
  ['Project scope',s.scope.text||'See the submitted answers and files below.'],
  ['Project details',[...answers,...[['Desired outcome',s.details.desiredOutcome],['Project context',s.details.workContext],['Budget',s.details.budget]].filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`)].join('\n')||'To be confirmed with the team.'],
  ['Project team',[s.routing.teamName,`Submitted through ${INTAKE_SITES[s.originSite].name}`,...s.routing.supportingServices.map(x=>x.replaceAll('-',' '))].join('\n')],
  ['Submitted files',s.scope.uploads.map(f=>`${f.name} (${f.size.toLocaleString('en-US')} bytes)`).join('\n')||'No files were submitted.'],
  ...(s.unresolved.length?[['Details to confirm',s.unresolved.join('\n')] as [string,string]]:[]),
  ...(s.details.transcript.length?[['Your submitted conversation',s.details.transcript.map(m=>`${m.role==='user'?'You':'Project assistant'}${m.label?` · ${m.label}`:''}: ${m.text}${m.caption?`\n${m.caption}`:''}${m.files?.length?`\nFiles: ${m.files.join(', ')}`:''}`).join('\n\n')] as [string,string]]:[]),
 ];
}

export async function renderIntakePdf(s:IntakeSnapshot):Promise<Buffer> {
 const site=INTAKE_SITES[s.currentSite],reference=intakeReference(s.projectId,s.reference);
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const regular=await pdf.embedFont(await readFile(path.join(process.cwd(),'public/p5-estimate/estimate-sans-regular.ttf')),{subset:true});
 const bold=await pdf.embedFont(await readFile(path.join(process.cwd(),'public/p5-estimate/estimate-sans-bold.ttf')),{subset:true});
 const ink=hex('#2C302F'),muted=hex('#565D58'),accent=hex(brand.id===s.currentSite?brand.accent:'#D0B496');
 const sections=intakePdfSections(s);
 // Never silently replace unsupported names or scope text with missing-glyph boxes.
 // The accepted snapshot remains durable; delivery is held for document review.
 const supported=new Set(regular.getCharacterSet());
 for(const character of clean(sections.flat().join(' '))) {
  if(!/\s/u.test(character)&&!supported.has(character.codePointAt(0)!))throw Error('payload-review');
 }
 if(Buffer.byteLength(JSON.stringify(sections))>2*1024*1024)throw Error('payload-review');
 let page:PDFPage,y=0;const pages:PDFPage[]=[];
 const newPage=()=>{
  if(pages.length>=250)throw Error('payload-review');
  page=pdf.addPage([612,792]);pages.push(page);y=660;
  page.drawText(site.name,{x:48,y:744,size:20,font:bold,color:ink});
  page.drawText(`${site.domain}  |  ${brand.phone}`,{x:48,y:724,size:10,font:regular,color:muted});
  page.drawText(INTAKE_RECIPIENTS[s.currentSite],{x:48,y:708,size:10,font:regular,color:muted});
  page.drawLine({start:{x:48,y:692},end:{x:564,y:692},thickness:2,color:accent});
 };
 const ensure=(space:number)=>{if(y-space<70)newPage();};
 const paragraph=(text:string,size=10.5,heading=false)=>{
  const font=heading?bold:regular,lineHeight=size*1.45;
  // Preserve customer newlines and split even an unbroken URL or long word.
  for(const raw of text.replace(/\r\n?/g,'\n').split('\n')) {
   if(!raw){ensure(lineHeight);y-=lineHeight;continue;}
   for(const line of wrap(clean(raw),font,size,516)){
    ensure(lineHeight);page.drawText(line,{x:48,y:y-size,size,font,color:heading?ink:muted});y-=lineHeight;
   }
  }
 };
 newPage();paragraph('Project request',23,true);y-=7;
 paragraph(`Reference ${reference}`,11,true);paragraph(`Received ${intakeSavedAt(s.savedAt)}`,9);y-=12;
 for(const [title,body] of sections){ensure(55);paragraph(title,14,true);y-=5;paragraph(body);y-=16;}
 for(const [i,p] of pages.entries()){
  p.drawLine({start:{x:48,y:53},end:{x:564,y:53},thickness:.5,color:rgb(.8,.82,.8)});
  p.drawText(`${reference}  |  Project request, not a priced estimate`,{x:48,y:36,size:8,font:regular,color:muted});
  const label=`${i+1} / ${pages.length}`;
  p.drawText(label,{x:564-regular.widthOfTextAtSize(label,8),y:36,size:8,font:regular,color:muted});
 }
 pdf.setTitle(`${site.name} project request ${reference}`);pdf.setAuthor(site.name);pdf.setSubject('Received project request');
 if(Number.isFinite(Date.parse(s.savedAt))){pdf.setCreationDate(new Date(s.savedAt));pdf.setModificationDate(new Date(s.savedAt));}
 return Buffer.from(await pdf.save());
}
