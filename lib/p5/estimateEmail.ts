import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {legalIdentityLine} from './brandIdentity.ts';
import {buildAdminSummary,adminBasis} from './adminEstimate.ts';
import {buildEstimateDocument,issueRecord,type EstimateBrand,type EstimateDocument,type EstimateIssue} from './estimateDocument.ts';

/**
 * Customer and internal estimate emails, both in the approved template (2026-09-21). Table-based
 * layout with inline styles so Gmail, Outlook and Apple Mail render them alike. Internal costs and
 * margins appear only in the internal email.
 */
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const FONT="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/**
 * The customer email is the approved preliminary online estimate in email form. It is built from the
 * same document model as the attached PDF (estimateDocument.ts), so the reference, date, brand,
 * finish, categories, total, exclusions and next steps agree across channels. Long lists are capped
 * here and named in full in the PDF; nothing the customer asked for is summarised away.
 */
const EMAIL_LIMIT=5;
function capped(items:string[],limit=EMAIL_LIMIT){
 const shown=items.slice(0,limit);
 const rest=items.length-shown.length;
 return {shown,note:rest>0?`${rest} more ${rest===1?'item is':'items are'} listed in the attached PDF.`:''};
}
const tintOf=(hex:string,amount=.12)=>'#'+[1,3,5].map(i=>Math.round(255-(255-parseInt(hex.slice(i,i+2),16))*amount).toString(16).padStart(2,'0')).join('');
/** An estimate saved before issue records existed still carries its contact and reviewed scope. */
function fallbackIssue(id:string,record:any):Partial<EstimateIssue>|null{
 if(!record?.scope&&!record?.contact)return null;
 const base=record.scope?issueRecord({brandId:brand.id,id,revision:Number(record.revision)||0,now:new Date(0),contact:record.contact||{name:'',email:''},scope:record.scope}):{contact:{name:String(record.contact?.name||''),email:String(record.contact?.email||''),phone:String(record.contact?.phone||'')}};
 return {...base,issuedAt:''};
}
export function customerEstimateDocument(id:string,record:any){
 return buildEstimateDocument({id,result:record.customer||{},brand:brand as unknown as EstimateBrand,issue:record.customer?.issue||fallbackIssue(id,record),submittedAt:record.submittedAt||null,legalLine:legalIdentityLine()});
}
const C={ink:'#2C302F',muted:'#565D58',soft:'#6F7671',line:'#E1E5DD',page:'#F4F4F2'} as const;
function customerHtml(doc:EstimateDocument){
 const tint=tintOf(doc.brand.accent);const accent=doc.brand.accent;
 const kicker=(t:string)=>`<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.soft}">${escape(t)}</p>`;
 const h2=(t:string)=>`<h2 style="margin:28px 0 10px;font-size:18px;line-height:1.3;font-weight:700;color:${C.ink};${FONT}">${escape(t)}</h2>`;
 const list=(items:string[],note='')=>`<ul style="margin:0;padding:0 0 0 20px">${items.map(x=>`<li style="margin:0 0 6px;font-size:15px;line-height:1.55;color:${C.ink}">${escape(x)}</li>`).join('')}</ul>${note?`<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${C.soft}">${escape(note)}</p>`:''}`;
 const parts:string[]=[];
 const first=doc.customer.name.split(' ')[0];
 parts.push(`<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${C.ink}">${escape(first?`Hi ${first},`:'Hello,')}</p>`);
 parts.push(`<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${C.ink}">Thank you for using the ${escape(doc.brand.name)} online estimator. Your preliminary estimate is below, and the complete estimate is attached as a PDF.</p>`);
 // Total first: the number, what it is, and whether anything requested is still unpriced.
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 16px"><tr><td style="padding:18px 20px;background:${tint};border-top:2px solid ${accent}">${kicker(doc.total?.label||'Estimate status')}<p style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:${C.ink};${FONT}">${escape(doc.total?.amount||'Pricing pending review')}</p>${doc.partialNote?`<p style="margin:10px 0 0;font-size:14px;line-height:1.5;font-weight:700;color:${C.ink}">${escape(doc.partialNote)}</p>`:''}</td></tr></table>`);
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 8px"><tr><td style="padding:14px 18px;background:${tint};border-left:3px solid ${accent}">${kicker(doc.finish.heading)}<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:${C.ink}">${escape(doc.finish.name)}</p><p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:${C.muted}">${escape(doc.finish.detail)}</p><p style="margin:0;font-size:13px;line-height:1.5;color:${C.soft}">${escape(doc.finish.basis)}</p></td></tr></table>`);
 if(doc.categories.length){
  parts.push(h2('Scope & pricing'));
  const rows=doc.categories.map(c=>{const work=capped([...c.work,...c.allowances.map(a=>`Allowance included: ${a}`)],3);
   return `<tr><td style="padding:12px 0 4px;border-bottom:1px solid ${accent};font-size:15px;font-weight:700;color:${C.ink}">${escape(`${c.number}  ${c.title}`)}</td><td style="padding:12px 0 4px;border-bottom:1px solid ${accent};font-size:15px;font-weight:700;color:${C.ink};text-align:right;white-space:nowrap;vertical-align:bottom">${escape(c.amount)}</td></tr>`+
    // One bullet per task with its priced items beneath, so tasks read apart (owner report 2026-09-22).
    (work.shown.length?`<tr><td colspan="2" style="padding:6px 0 8px;font-size:14px;line-height:1.5;color:${C.ink}">${(()=>{const items=(c.items||[]).slice(0,3);if(!items.length)return `<ul style="margin:0;padding:0 0 0 18px">${work.shown.map(w=>`<li style="margin:0 0 6px">${escape(w)}</li>`).join('')}</ul>`;
      return `<ul style="margin:0;padding:0 0 0 18px">${items.map(i=>`<li style="margin:0 0 8px;padding:0 0 6px;border-bottom:1px solid ${C.line}">${escape(i.task)}${i.added?` <span style="color:${C.soft};font-size:12px">(included to complete the work)</span>`:''}${i.where?`<br><span style="font-size:12px;color:${C.soft}">${escape(i.where)}</span>`:''}${i.details.filter(d=>d.text||d.qty).map(d=>`<br><span style="font-size:13px;color:${C.muted}">${escape(d.text)}${d.qty?`${d.text?', ':''}${escape(d.qty)}`:''}</span>`).join('')}</li>`).join('')}</ul>${(c.items||[]).length>3?`<span style="font-size:12px;color:${C.soft}">${(c.items||[]).length-3} more item${(c.items||[]).length-3===1?'':'s'} in the attached PDF.</span>`:''}`;})()}${work.note&&!(c.items||[]).length?`<br><span style="color:${C.soft}">${escape(work.note)}</span>`:''}</td></tr>`:'');}).join('');
  const subtotal=doc.subtotal?`<tr><td style="padding:10px 0;font-size:14px;color:${C.muted}">Included categories subtotal</td><td style="padding:10px 0;font-size:14px;color:${C.muted};text-align:right">${escape(doc.subtotal)}</td></tr>`:'';
  const total=`<tr><td style="padding:12px 10px;background:${tint};border-top:1px solid ${accent};font-size:17px;font-weight:700;color:${C.ink}">${escape(doc.total?.label||'Estimate status')}</td><td style="padding:12px 10px;background:${tint};border-top:1px solid ${accent};font-size:17px;font-weight:700;color:${C.ink};text-align:right;white-space:nowrap">${escape(doc.total?.amount||'Pending review')}</td></tr>`;
  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${rows}${subtotal}${total}</table>`);
  parts.push(doc.totalNotes.map(n=>`<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${C.soft}">${escape(n)}</p>`).join(''));
 }
 parts.push(h2('Exclusions'));
 if(doc.exclusions.length){const e=capped(doc.exclusions);parts.push(kicker(doc.exclusionsNote)+list(e.shown,e.note));}
 else parts.push(`<p style="margin:0;font-size:14px;line-height:1.55;color:${C.muted}">${escape(doc.exclusionsNote)}</p>`);
 const confirm=doc.assumptionRows.find(([label])=>label==='To confirm');
 if(confirm){parts.push(h2('Items to confirm'));const c=capped(confirm[1],4);parts.push(list(c.shown,c.note));}
 parts.push(h2('Next steps'));
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${doc.nextSteps.map(([title,body],i)=>`<tr><td style="padding:0 12px 12px 0;vertical-align:top;font-size:16px;font-weight:700;color:${C.ink};width:28px">${String(i+1).padStart(2,'0')}</td><td style="padding:0 0 12px;vertical-align:top"><p style="margin:0 0 2px;font-size:15px;font-weight:700;color:${C.ink}">${escape(title)}</p><p style="margin:0;font-size:14px;line-height:1.5;color:${C.muted}">${escape(body)}</p></td></tr>`).join('')}</table>`);
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:8px 0 16px"><tr><td align="center" style="padding:18px 16px;background:${tint};border:1px solid ${accent}"><a href="${escape(doc.review.mailto)}" style="display:inline-block;padding:12px 22px;border:1px solid ${C.ink};border-radius:6px;background:#FFFFFF;font-size:15px;font-weight:700;color:${C.ink};text-decoration:none;${FONT}">${escape(doc.review.label)}</a><p style="margin:10px 0 0;font-size:14px;color:${C.muted}"><a href="${escape(doc.review.mailto)}" style="color:${C.muted}">${escape(doc.review.email)}</a> &nbsp;|&nbsp; <a href="${escape(doc.review.tel)}" style="color:${C.muted};text-decoration:none">${escape(doc.review.phone)}</a></p></td></tr></table>`);
 parts.push(`<p style="margin:0;font-size:13px;line-height:1.55;color:${C.muted}"><b style="color:${C.ink}">${escape(doc.notice.lead)}</b> ${escape(doc.notice.text)}</p>`);
 return parts.join('');
}
function customerLayout(doc:EstimateDocument,body:string){
 const site=`https://${doc.brand.domain}`;
 const endorsement=doc.brand.endorsed?`<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${C.soft}"><img src="${escape(`${site}/p5-estimate/p5-mark.png`)}" alt="P5" width="18" height="18" style="width:18px;height:18px;border:0;vertical-align:middle;margin-right:6px">A P5 Home Co. brand</p>`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(`${doc.title} ${doc.reference}`)}</title><style>body{margin:0;padding:0}@media (max-width:640px){.container{width:100%!important}.pad{padding:20px 16px!important}h1{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};${FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(`${doc.total?`${doc.total.label}: ${doc.total.amount}. `:''}Estimate ${doc.reference}`)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="container" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid ${C.line}">
 <tr><td class="pad" style="padding:26px 28px 18px;border-bottom:1px solid ${doc.brand.accent}"><img src="${escape(`${site}${doc.brand.logo}`)}" alt="${escape(doc.brand.name)}" width="220" style="display:block;width:220px;max-width:70%;height:auto;border:0"></td></tr>
 <tr><td class="pad" style="padding:22px 28px 0">
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.soft}">Preliminary online estimate</p>
  <h1 style="margin:0 0 6px;font-size:28px;line-height:1.2;font-weight:700;color:${C.ink};${FONT}">${escape(doc.title)}</h1>
  ${doc.projectName?`<p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:${C.muted}">${escape(doc.projectName)}</p>`:''}
  <p style="margin:0 0 20px;font-size:13px;color:${C.soft}">Estimate ${escape(doc.reference)}${doc.issuedLabel?` &nbsp;|&nbsp; Prepared ${escape(doc.issuedLabel)}`:''}</p>
 </td></tr>
 <tr><td class="pad" style="padding:0 28px 28px">${body}</td></tr>
 <tr><td class="pad" style="padding:18px 28px 22px;border-top:1px solid ${C.line}">
  <p style="margin:0;font-size:13px;line-height:1.6;color:${C.muted}"><b style="color:${C.ink}">${escape(doc.brand.name)}</b> &nbsp;|&nbsp; <a href="${escape(doc.review.tel)}" style="color:${C.muted};text-decoration:none">${escape(doc.brand.phone)}</a> &nbsp;|&nbsp; <a href="mailto:${escape(doc.brand.email)}" style="color:${C.muted}">${escape(doc.brand.email)}</a> &nbsp;|&nbsp; <a href="${escape(site)}" style="color:${C.muted}">${escape(doc.brand.domain)}</a></p>
  ${endorsement}${doc.legalLine?`<p style="margin:6px 0 0;font-size:11px;line-height:1.5;color:${C.soft}">${escape(doc.legalLine)}</p>`:''}
 </td></tr>
</table></td></tr></table></body></html>`;
}
function customerText(doc:EstimateDocument){
 const lines:string[]=[doc.brand.name,'PRELIMINARY ONLINE ESTIMATE',doc.title,...(doc.projectName?[doc.projectName]:[]),`Estimate ${doc.reference}${doc.issuedLabel?` | Prepared ${doc.issuedLabel}`:''}`,''];
 lines.push(`${(doc.total?.label||'Estimate status').toUpperCase()}: ${doc.total?.amount||'Pricing pending review'}`);if(doc.partialNote)lines.push(doc.partialNote);lines.push('');
 lines.push(doc.finish.heading.toUpperCase(),doc.finish.name,doc.finish.detail,doc.finish.basis,'');
 if(doc.categories.length){lines.push('SCOPE & PRICING');for(const c of doc.categories){lines.push(`${c.number}  ${c.title}${c.amount?`: ${c.amount}`:''}`);for(const w of c.work)lines.push(`  - ${w}`);for(const a of c.allowances)lines.push(`  - Allowance included: ${a}`);}
  if(doc.subtotal)lines.push(`Included categories subtotal: ${doc.subtotal}`);lines.push(`${doc.total?.label||'Estimate status'}: ${doc.total?.amount||'Pricing pending review'}`,...doc.totalNotes,'');}
 lines.push('EXCLUSIONS');if(doc.exclusions.length){lines.push(doc.exclusionsNote);for(const e of doc.exclusions)lines.push(`  - ${e}`);}else lines.push(doc.exclusionsNote);lines.push('');
 lines.push('ASSUMPTIONS & ITEMS TO CONFIRM');for(const [label,values] of doc.assumptionRows){lines.push(`${label}:`);for(const v of values)lines.push(`  - ${v}`);}lines.push('');
 lines.push('NEXT STEPS');doc.nextSteps.forEach(([title,body],i)=>lines.push(`${String(i+1).padStart(2,'0')} ${title}: ${body}`));
 lines.push('',`${doc.review.label}: ${doc.review.email} | ${doc.review.phone}`,'',`${doc.notice.lead} ${doc.notice.text}`,'',`${doc.brand.name} | ${doc.brand.phone} | ${doc.brand.email} | ${doc.brand.domain}`);
 if(doc.brand.endorsed)lines.push('A P5 Home Co. brand');if(doc.legalLine)lines.push(doc.legalLine);
 lines.push('','Your complete estimate is attached as a PDF.');
 return lines.join('\n');
}
/**
 * The internal team email: the admin summary (adminEstimate.ts) in a short, scannable form. Who,
 * where, status, the price build-up, cost by trade and what still needs attention; every priced line
 * is in the attached internal PDF and the admin screen.
 */
function adminEmail(id:string,record:any){
 const s=buildAdminSummary({id,record:{...record.internal,customer:record.customer,contact:record.contact,scope:record.scope},brand:brand as unknown as EstimateBrand,submittedAt:record.submittedAt||null,legalLine:legalIdentityLine()});
 const doc=s.doc;const tint=tintOf(doc.brand.accent);const accent=doc.brand.accent;const site=`https://${doc.brand.domain}`;
 const alert='#9E3324',alertTint='#FBEDE9';
 const h2=(t:string)=>`<h2 style="margin:24px 0 8px;font-size:16px;font-weight:700;color:${C.ink};${FONT}">${escape(t)}</h2>`;
 const table=(rows:[string,string,boolean?][])=>`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${rows.map(([k,v,strong])=>`<tr><td style="padding:7px ${strong?'10px':'0'};border-bottom:1px solid ${C.line};${strong?`background:${tint};`:''}font-size:14px;${strong?'font-weight:700;':''}color:${C.ink}">${escape(k)}</td><td style="padding:7px ${strong?'10px':'0'};border-bottom:1px solid ${C.line};${strong?`background:${tint};`:''}font-size:14px;${strong?'font-weight:700;':''}color:${C.ink};text-align:right;white-space:nowrap">${escape(v)}</td></tr>`).join('')}</table>`;
 const list=(items:string[],color:string=C.ink)=>`<ul style="margin:0;padding:0 0 0 18px">${items.map(x=>`<li style="margin:0 0 5px;font-size:14px;line-height:1.5;color:${/^Blocking|^Not priced/.test(x)?alert:color}">${escape(x)}</li>`).join('')}</ul>`;
 const confirm=(doc.assumptionRows.find(([k])=>k==='To confirm')?.[1]||[]).filter(c=>!/: not priced yet; we will quote it after a site visit\.$/.test(c)).map(c=>`Customer to confirm: ${c}`);
 const open=capped([...s.notPriced.map(n=>`Not priced: ${n}`),...confirm],6);const checks=capped(s.checks,6);const trades=capped(s.trades.map(t=>`${t.trade}|${t.cost}|${t.share}`),8);
 const parts:string[]=[];
 parts.push(`<p style="margin:0 0 16px;padding:10px 14px;background:${alertTint};font-size:13px;line-height:1.5;color:${alert}"><b>Internal estimate record.</b> Confidential; do not forward to the customer.</p>`);
 parts.push(`<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.soft}">Internal estimate record</p><h1 style="margin:0 0 4px;font-size:24px;line-height:1.25;font-weight:700;color:${C.ink};${FONT}">${escape(doc.title)}</h1>${doc.projectName?`<p style="margin:0 0 4px;font-size:15px;color:${C.muted}">${escape(doc.projectName)}</p>`:''}<p style="margin:0 0 14px;font-size:13px;color:${C.soft}">Estimate ${escape(doc.reference)}${doc.issuedLabel?` &nbsp;|&nbsp; ${escape(doc.issuedLabel)}`:''}</p>`);
 parts.push(`<p style="margin:0;padding:10px 14px;background:${s.released?tint:alertTint};border-left:3px solid ${s.released?accent:alert};font-size:14px;font-weight:700;color:${s.released?C.ink:alert}">${escape(s.status)}</p>`);
 parts.push(h2('Lead'));
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${([['Customer',escape(doc.customer.name||'Not supplied')],['Email',doc.customer.email?`<a href="mailto:${escape(doc.customer.email)}" style="color:${C.ink}">${escape(doc.customer.email)}</a>`:'Not supplied'],['Phone',doc.customer.phone?`<a href="tel:${escape(doc.customer.phone.replace(/[^\d+]/g,''))}" style="color:${C.ink}">${escape(doc.customer.phone)}</a>`:'Not supplied'],['Location',escape(doc.location.join(', ')||'Not stated')],['Finish',escape(`${doc.finish.name} (${adminBasis(doc)})`)]] as [string,string][]).map(([k,v])=>`<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid ${C.line};font-size:13px;color:${C.soft};width:90px;vertical-align:top">${k}</td><td style="padding:6px 0;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink}">${v}</td></tr>`).join('')}</table>`);
 parts.push(h2('Price build-up'));
 parts.push(table([...s.build.map(([k,v])=>[k,v] as [string,string]),['Contract price',s.contractPrice,true],[`Customer ${doc.priceKind==='range'?'range':'price'}${doc.status==='partial'?' (partial)':''}`,s.customerPrice,true]]));
 if(s.trades.length){parts.push(h2('Direct cost by trade'));parts.push(table(trades.shown.map(t=>{const [trade,cost,share]=t.split('|');return [trade,`${cost}${share?`  (${share})`:''}`] as [string,string];})));if(trades.note)parts.push(`<p style="margin:6px 0 0;font-size:12px;color:${C.soft}">${escape(trades.note)}</p>`);}
 if(s.checks.length){parts.push(h2('Checks before a firm proposal'));parts.push(list(checks.shown));if(checks.note)parts.push(`<p style="margin:4px 0 0;font-size:12px;color:${C.soft}">${escape(checks.note)}</p>`);}
 if(open.shown.length){parts.push(h2('Open items'));parts.push(list(open.shown));if(open.note)parts.push(`<p style="margin:4px 0 0;font-size:12px;color:${C.soft}">${escape(open.note)}</p>`);}
 parts.push(`<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:${C.muted}">Attached: the internal record with every priced line (PDF). <a href="${escape(`${site}/admin/p5-estimators`)}" style="color:${C.ink}">Open the estimator admin</a> for the saved record and the customer copy.</p>`);
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(`Internal record ${doc.reference}`)}</title></head><body style="margin:0;padding:0;background:${C.page};${FONT}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.page}"><tr><td align="center" style="padding:20px 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid ${C.line}"><tr><td style="padding:20px 24px 14px;border-bottom:1px solid ${accent}"><img src="${escape(`${site}${doc.brand.logo}`)}" alt="${escape(doc.brand.name)}" width="180" style="display:block;width:180px;max-width:60%;height:auto;border:0"></td></tr><tr><td style="padding:18px 24px 24px">${parts.join('')}</td></tr></table></td></tr></table></body></html>`;
 const lines:string[]=['INTERNAL ESTIMATE RECORD - CONFIDENTIAL, DO NOT FORWARD TO THE CUSTOMER','',`${doc.title}${doc.projectName?`: ${doc.projectName}`:''}`,`Estimate ${doc.reference}${doc.issuedLabel?` | ${doc.issuedLabel}`:''}`,`Status: ${s.status}`,'',
  'LEAD',`Customer: ${doc.customer.name||'Not supplied'}`,`Email: ${doc.customer.email||'Not supplied'}`,`Phone: ${doc.customer.phone||'Not supplied'}`,`Location: ${doc.location.join(', ')||'Not stated'}`,`Finish: ${doc.finish.name} (${adminBasis(doc)})`,'',
  'PRICE BUILD-UP',...s.build.map(([k,v])=>`${k}: ${v}`),`Contract price: ${s.contractPrice}`,`Customer ${doc.priceKind==='range'?'range':'price'}: ${s.customerPrice}`,''];
 if(s.trades.length)lines.push('DIRECT COST BY TRADE',...s.trades.map(t=>`${t.trade}: ${t.cost}${t.share?` (${t.share})`:''}`),'');
 if(s.checks.length)lines.push('CHECKS BEFORE A FIRM PROPOSAL',...checks.shown.map(c=>`- ${c}`),...(checks.note?[checks.note]:[]),'');
 if(open.shown.length)lines.push('OPEN ITEMS',...open.shown.map(c=>`- ${c}`),...(open.note?[open.note]:[]),'');
 lines.push('The internal record with every priced line is attached (PDF).',`Admin: ${site}/admin/p5-estimators`);
 return {html,text:lines.join('\n')};
}
export function estimateEmail(id:string,record:any,admin:boolean){
 // The customer email is the approved estimate, built from the same document as the attached PDF;
 // the internal email is the short admin summary of the same saved record.
 if(!admin){const doc=customerEstimateDocument(id,record);return {text:customerText(doc),html:customerLayout(doc,customerHtml(doc))};}
 return adminEmail(id,record);
}
