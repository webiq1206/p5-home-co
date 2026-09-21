import {priceText,priceLabel,estimateSections,groupSections,money,orderedSections,scopeBullets,type EstimateSection} from './presentation.ts';
import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {documentFooterLine,legalIdentityLine} from './brandIdentity.ts';
import {buildEstimateDocument,issueRecord,type EstimateBrand,type EstimateDocument,type EstimateIssue} from './estimateDocument.ts';

/**
 * Customer and internal estimate emails.
 *
 * Table-based layout with inline styles so Gmail, Outlook and Apple Mail
 * render it the same way: a 600px container with generous internal padding,
 * a brand header, the planning range, then the project under distinct
 * headings in reading order (what the project is, what is included, what it
 * costs by category, what is excluded, allowances, items to confirm, next
 * steps). Excluded work is never listed under an included heading. Internal
 * costs and margins appear only in the internal record.
 */
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const FONT="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF="font-family:Georgia,'Times New Roman',serif";
const PALETTE={paper:'#F2F0EB',card:'#FFFFFF',ink:'#20231F',muted:'#5F6862',soft:'#7A837D',line:'#E1E5DD',accent:brand.accent,included:'#E4EFE7',includedInk:'#1F4A33',excluded:'#F7E5E2',excludedInk:'#7A2F22',allowance:'#F6EFDF',allowanceInk:'#6B4E12',assumption:'#E6EEF3',assumptionInk:'#2D4A5E',button:'#17211C',buttonInk:'#FBFAF6'} as const;
const SITE=`https://${brand.domain}`;

type Tag={label:string;bg:string;ink:string};
const TAGS:Record<string,Tag>={included:{label:'Included',bg:PALETTE.included,ink:PALETTE.includedInk},category:{label:'Included',bg:PALETTE.included,ink:PALETTE.includedInk},excluded:{label:'Not included',bg:PALETTE.excluded,ink:PALETTE.excludedInk},allowance:{label:'Allowance',bg:PALETTE.allowance,ink:PALETTE.allowanceInk},assumption:{label:'To confirm',bg:PALETTE.assumption,ink:PALETTE.assumptionInk}};

function tag(kind?:string){const t=kind?TAGS[kind]:undefined;return t?`<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${t.bg};color:${t.ink};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;${FONT};vertical-align:middle;margin-left:8px">${t.label}</span>`:'';}
function bullets(items:string[]){return `<ul style="margin:0;padding:0 0 0 20px">${items.map(x=>`<li style="margin:0 0 8px;line-height:1.6;font-size:15px;color:${PALETTE.ink}">${escape(x)}</li>`).join('')}</ul>`;}
function rows(items:[string,string][]){
 return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${items.map(([k,v],i)=>{const parts=scopeBullets(v);return `<tr><td style="padding:${i?12:0}px 0 12px;border-top:${i?`1px solid ${PALETTE.line}`:'0'}"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${PALETTE.soft};${FONT}">${escape(k)}</p>${parts.length>1?`<ul style="margin:0;padding:0 0 0 18px">${parts.map(p=>`<li style="margin:0 0 4px;line-height:1.55;font-size:15px;color:${PALETTE.ink}">${escape(p)}</li>`).join('')}</ul>`:`<p style="margin:0;line-height:1.55;font-size:15px;color:${PALETTE.ink};white-space:pre-line">${escape(v)}</p>`}</td></tr>`;}).join('')}</table>`;
}
function card(section:EstimateSection,options:{heading?:'h2'|'h3';subtitle?:string}={}){
 const kind=section.kind;
 const border=kind==='excluded'?'#E6BAAC':kind==='allowance'?'#E7D9B6':kind==='assumption'?'#C5D4DF':PALETTE.line;
 const title=`<${options.heading||'h3'} style="margin:0;font-size:${options.heading==='h2'?'20px':'17px'};line-height:1.35;font-weight:700;color:${PALETTE.ink};${FONT}">${escape(section.title)}${kind==='category'&&section.text?`<span style="float:right;font-weight:700;font-size:15px;color:${PALETTE.ink};white-space:nowrap">${escape(section.text)}</span>`:tag(kind)}</${options.heading||'h3'}>`;
 const text=kind==='category'?'':section.text?`<p style="margin:10px 0 0;line-height:1.6;font-size:14px;color:${PALETTE.muted};white-space:pre-line">${escape(section.text)}</p>`:'';
 const body=[section.bullets?.length?bullets(section.bullets):'',section.rows?.length?rows(section.rows):''].filter(Boolean).join('<div style="height:12px"></div>');
 return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 14px"><tr><td style="padding:18px 20px;border:1px solid ${border};border-radius:12px;background:${PALETTE.card}">${title}${text}${body?`<div style="height:12px"></div>${body}`:''}</td></tr></table>`;
}
function heading(text:string,note?:string){return `<h2 style="margin:28px 0 12px;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PALETTE.soft};${FONT}">${escape(text)}</h2>${note?`<p style="margin:-4px 0 12px;font-size:14px;line-height:1.6;color:${PALETTE.muted}">${escape(note)}</p>`:''}`;}

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
    (work.shown.length?`<tr><td colspan="2" style="padding:6px 0 4px;font-size:14px;line-height:1.5;color:${C.muted}">${work.shown.map(escape).join('<br>')}${work.note?`<br><span style="color:${C.soft}">${escape(work.note)}</span>`:''}</td></tr>`:'');}).join('');
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
function internalBody(id:string,record:any){
 const result=record.customer,internal=record.internal||{};
 const parts:string[]=[];
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 16px"><tr><td style="padding:14px 18px;border-radius:10px;background:#FFF3EE;border:1px solid #E6BAAC"><p style="margin:0;font-size:14px;line-height:1.6;color:#7A2F22"><b>Confidential.</b> The internal attachment and financial breakdown are for the estimating team only. Do not forward this message to the customer.</p></td></tr></table>`);
 parts.push(heading('Lead'));
 parts.push(card({title:'Contact',rows:[['Reference',id],['Customer',record.contact?.name||'Not supplied'],['Email',record.contact?.email||'Not supplied'],['Phone',record.contact?.phone||'Not supplied'],['Service',String(record.scope?.answers?.service||'Not set')]]}));
 const range=result?.range?priceText(result.range):'Scope received for pricing review';
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 8px"><tr><td style="padding:20px 22px;border-radius:14px;background:${PALETTE.card};border:1px solid ${PALETTE.line};border-left:5px solid ${PALETTE.accent}"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PALETTE.soft}">Customer planning range</p><p style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:${PALETTE.ink};${SERIF}">${escape(range)}</p></td></tr></table>`);
 const financial:[string,string][]=([['Direct project cost',internal.directCost],['Contingency',internal.contingency],['Overhead recovery',internal.allocationDollars?.overhead],['Operating profit',internal.operatingProfit],['Recommended contract price',internal.contractPrice]] as [string,unknown][]).filter(([,v])=>typeof v==='number').map(([k,v])=>[k,money(Number(v))]);
 if(financial.length){parts.push(heading('Internal financial breakdown'));parts.push(card({title:'Pricing',rows:financial}));}
 if(internal.warnings?.length){parts.push(heading('Pricing checks requiring attention'));parts.push(card({title:'Warnings',kind:'assumption',bullets:internal.warnings.map((w:any)=>w.message||String(w))}));}
 parts.push(heading('Customer summary as delivered'));
 const g=groupSections(estimateSections(result||{}));
 for(const s of orderedSections([g.glance,g.brief,...g.included,...g.categories,...g.excluded,...g.allowances,...g.assumptions,...g.info].filter((s):s is EstimateSection=>Boolean(s))))parts.push(card(s));
 parts.push(`<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.muted}">Attached: the complete administrative estimate (PDF). Open <a href="${SITE}/admin/p5-estimators" style="color:${PALETTE.ink}">the estimator admin</a> to review the saved record.</p>`);
 return parts.join('');
}
function layout(title:string,subtitle:string,body:string){
 const logo=`${SITE}${brand.logo}`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(title)}</title><style>body{margin:0;padding:0}@media (max-width:640px){.container{width:100%!important}.pad{padding:20px 16px!important}.header{padding:22px 16px!important}h1{font-size:22px!important}}</style></head>
<body style="margin:0;padding:0;background:${PALETTE.paper};${FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(subtitle)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PALETTE.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="container" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:separate">
 <tr><td class="header" style="padding:28px 28px 22px;background:${PALETTE.card};border:1px solid ${PALETTE.line};border-bottom:0;border-radius:16px 16px 0 0">
  <img src="${escape(logo)}" alt="${escape(brand.name)}" width="220" style="display:block;width:220px;max-width:70%;height:auto;border:0;margin:0 0 18px">
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${PALETTE.soft}">${escape(subtitle)}</p>
  <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${PALETTE.ink};${SERIF}">${escape(title)}</h1>
 </td></tr>
 <tr><td style="height:4px;background:${PALETTE.accent};border-left:1px solid ${PALETTE.line};border-right:1px solid ${PALETTE.line}"></td></tr>
 <tr><td class="pad" style="padding:26px 28px 30px;background:${PALETTE.paper};border:1px solid ${PALETTE.line};border-top:0;border-radius:0 0 16px 16px">${body}</td></tr>
 <tr><td style="padding:22px 16px 0;text-align:center">
  <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${PALETTE.muted}"><b style="color:${PALETTE.ink}">${escape(brand.name)}</b> · <a href="tel:${escape(brand.phone.replace(/[^\d+]/g,''))}" style="color:${PALETTE.ink};text-decoration:none">${escape(brand.phone)}</a> · <a href="mailto:${escape(brand.email)}" style="color:${PALETTE.ink};text-decoration:none">${escape(brand.email)}</a></p>
  <p style="margin:0;font-size:12px;line-height:1.6;color:${PALETTE.soft}"><a href="${SITE}" style="color:${PALETTE.soft}">${escape(brand.domain)}</a> · Planning information only. Final scope and a written agreement are required.</p>
  <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:${PALETTE.soft}">${escape(documentFooterLine())}</p>
 </td></tr>
</table></td></tr></table></body></html>`;
}
function plainText(id:string,record:any,admin:boolean){
 const result=record.customer,internal=record.internal||{};
 const lines:string[]=[brand.name,admin?'CONFIDENTIAL INTERNAL ESTIMATE':'YOUR PROJECT ESTIMATE',`Reference: ${id}`,''];
 if(admin)lines.push('LEAD',`Customer: ${record.contact?.name||'Not supplied'}`,`Email: ${record.contact?.email||'Not supplied'}`,`Phone: ${record.contact?.phone||'Not supplied'}`,'');
 lines.push(result?.range?`${priceLabel(result.range).toUpperCase()}: ${priceText(result.range)}`:'STATUS: Scope received for pricing review',result?.message||'','');
 const g=groupSections(estimateSections(result||{}));
 const block=(title:string,sections:EstimateSection[],note?:string)=>{if(!sections.length)return;lines.push(title.toUpperCase());if(note)lines.push(note);for(const s of sections){lines.push('',`${s.title}${s.kind==='category'&&s.text?`: ${s.text}`:''}`);if(s.text&&s.kind!=='category')lines.push(s.text);for(const b of s.bullets||[])lines.push(`  - ${b}`);for(const [k,v] of s.rows||[])lines.push(`  ${k}: ${v.replace(/\n+/g,' ')}`);}lines.push('');};
 {
  block('Project summary',[g.glance,g.brief].filter((s):s is EstimateSection=>Boolean(s)));
  block('What is included',[...g.included,...g.categories],g.categoriesIntro?.text);
  block('Not included',g.excluded,'The following work is not part of this estimate.');
  block('Allowances',g.allowances);
  block('Assumptions and items to confirm',g.assumptions);
  block('Supporting details',g.info);
 }
 if(admin){
  const financial=([['Direct project cost',internal.directCost],['Contingency',internal.contingency],['Overhead recovery',internal.allocationDollars?.overhead],['Operating profit',internal.operatingProfit],['Recommended contract price',internal.contractPrice]] as [string,unknown][]).filter(([,v])=>typeof v==='number');
  if(financial.length){lines.push('INTERNAL FINANCIAL BREAKDOWN');for(const [k,v] of financial)lines.push(`  ${k}: ${money(Number(v))}`);lines.push('');}
  if(internal.warnings?.length){lines.push('PRICING CHECKS REQUIRING ATTENTION');for(const w of internal.warnings)lines.push(`  - ${w.message||String(w)}`);lines.push('');}
 }
 lines.push(legalIdentityLine(),'','The complete administrative estimate is attached. Do not forward it to the customer.');
 return lines.join('\n');
}
export function estimateEmail(id:string,record:any,admin:boolean){
 // The customer email is the approved estimate, built from the same document as the attached PDF.
 if(!admin){const doc=customerEstimateDocument(id,record);return {text:customerText(doc),html:customerLayout(doc,customerHtml(doc))};}
 // The administrative email keeps the saved record and shows the customer sections as delivered.
 return {text:plainText(id,record,true),html:layout('Internal estimate record',`Confidential · Reference ${id.slice(0,8)}`,internalBody(id,record))};
}
