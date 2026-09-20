import {customerPresentation,estimateSections,groupSections,money,orderedSections,scopeBullets,type EstimateSection} from './presentation.ts';
import {ESTIMATOR_BRAND as brand} from './brand.ts';

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
function button(label:string,href:string,primary=true){return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 10px 10px 0"><tr><td style="border-radius:10px;background:${primary?PALETTE.button:PALETTE.card};border:1px solid ${primary?PALETTE.button:'#B7C0B8'}"><a href="${escape(href)}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:${primary?PALETTE.buttonInk:PALETTE.ink};text-decoration:none;${FONT}">${escape(label)}</a></td></tr></table>`;}

function customerBody(id:string,result:any,contact:{name?:string}|undefined){
 const sections=estimateSections(result);
 const g=groupSections(sections);
 const range=result.range?`${money(result.range.low)} to ${money(result.range.high)}`:'';
 const parts:string[]=[];
 parts.push(`<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${PALETTE.ink}">${escape(contact?.name?`Hi ${contact.name.split(' ')[0]},`:'Hello,')}</p>`);
 parts.push(`<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${PALETTE.ink}">Thank you for using the ${escape(brand.name)} project estimator. Your complete project summary is below and attached as a PDF.</p>`);
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 8px"><tr><td style="padding:22px 22px;border-radius:14px;background:${PALETTE.card};border:1px solid ${PALETTE.line};border-left:5px solid ${PALETTE.accent}"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PALETTE.soft}">${range?'Preliminary planning range':'Status'}</p><p style="margin:0 0 8px;font-size:${range?'32px':'22px'};line-height:1.2;font-weight:700;color:${PALETTE.ink};${SERIF}">${escape(range||'Scope received for pricing review')}</p><p style="margin:0;font-size:15px;line-height:1.6;color:${PALETTE.muted}">${escape(result.message||'')}</p></td></tr></table>`);
 if(g.glance||g.brief){parts.push(heading('Project summary'));if(g.glance)parts.push(card(g.glance));if(g.brief)parts.push(card(g.brief));}
 if(g.included.length||g.categories.length){parts.push(heading(result.range?'What is included':'Requested work',g.categories.length?g.categoriesIntro?.text:undefined));for(const s of g.included)parts.push(card(s));for(const s of g.categories)parts.push(card(s));}
 if(g.excluded.length){parts.push(heading('Not included','The following work is not part of this estimate.'));for(const s of g.excluded)parts.push(card(s));}
 if(g.allowances.length){parts.push(heading('Allowances','Amounts carried in the range for selections that are not final yet.'));for(const s of g.allowances)parts.push(card(s));}
 if(g.assumptions.length){parts.push(heading('Assumptions and items to confirm','These affect the final price and will be confirmed with you before a firm proposal.'));for(const s of g.assumptions)parts.push(card(s));}
 if(g.info.length){parts.push(heading('Supporting details'));for(const s of g.info)parts.push(card(s));}
 parts.push(heading('Next step'));
 parts.push(`<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${PALETTE.ink}">${escape(result.nextStep||'Schedule a consultation to confirm the scope and refine this range.')}</p>`);
 parts.push(`<div>${button('Schedule a consultation',`${SITE}${brand.consultationPath}`)}${button(`Call ${brand.phone}`,`tel:${brand.phone.replace(/[^\d+]/g,'')}`,false)}</div>`);
 parts.push(`<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.muted}">Attached: <b>${escape(brand.id)}-estimate-${escape(id)}-customer.pdf</b>, the complete summary including every section above.</p>`);
 parts.push(`<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${PALETTE.soft}">${escape(result.disclaimer||'')}</p>`);
 return parts.join('');
}
function internalBody(id:string,record:any){
 const result=record.customer,internal=record.internal||{};
 const parts:string[]=[];
 parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 16px"><tr><td style="padding:14px 18px;border-radius:10px;background:#FFF3EE;border:1px solid #E6BAAC"><p style="margin:0;font-size:14px;line-height:1.6;color:#7A2F22"><b>Confidential.</b> The internal attachment and financial breakdown are for the estimating team only. Do not forward this message to the customer.</p></td></tr></table>`);
 parts.push(heading('Lead'));
 parts.push(card({title:'Contact',rows:[['Reference',id],['Customer',record.contact?.name||'Not supplied'],['Email',record.contact?.email||'Not supplied'],['Phone',record.contact?.phone||'Not supplied'],['Service',String(record.scope?.answers?.service||'Not set')]]}));
 const range=result?.range?`${money(result.range.low)} to ${money(result.range.high)}`:'Scope received for pricing review';
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
 </td></tr>
</table></td></tr></table></body></html>`;
}
function plainText(id:string,record:any,admin:boolean){
 const result=record.customer,internal=record.internal||{};
 const lines:string[]=[brand.name,admin?'CONFIDENTIAL INTERNAL ESTIMATE':'YOUR PROJECT ESTIMATE',`Reference: ${id}`,''];
 if(admin)lines.push('LEAD',`Customer: ${record.contact?.name||'Not supplied'}`,`Email: ${record.contact?.email||'Not supplied'}`,`Phone: ${record.contact?.phone||'Not supplied'}`,'');
 lines.push(result?.range?`PLANNING RANGE: ${money(result.range.low)} to ${money(result.range.high)}`:'STATUS: Scope received for pricing review',result?.message||'','');
 const g=groupSections(estimateSections(result||{}));
 const block=(title:string,sections:EstimateSection[],note?:string)=>{if(!sections.length)return;lines.push(title.toUpperCase());if(note)lines.push(note);for(const s of sections){lines.push('',`${s.title}${s.kind==='category'&&s.text?`: ${s.text}`:''}`);if(s.text&&s.kind!=='category')lines.push(s.text);for(const b of s.bullets||[])lines.push(`  - ${b}`);for(const [k,v] of s.rows||[])lines.push(`  ${k}: ${v.replace(/\n+/g,' ')}`);}lines.push('');};
 block('Project summary',[g.glance,g.brief].filter((s):s is EstimateSection=>Boolean(s)));
 block(result?.range?'What is included':'Requested work',[...g.included,...g.categories],g.categoriesIntro?.text);
 block('Not included',g.excluded,'The following work is not part of this estimate.');
 block('Allowances',g.allowances);
 block('Assumptions and items to confirm',g.assumptions);
 block('Supporting details',g.info);
 if(admin){
  const financial=([['Direct project cost',internal.directCost],['Contingency',internal.contingency],['Overhead recovery',internal.allocationDollars?.overhead],['Operating profit',internal.operatingProfit],['Recommended contract price',internal.contractPrice]] as [string,unknown][]).filter(([,v])=>typeof v==='number');
  if(financial.length){lines.push('INTERNAL FINANCIAL BREAKDOWN');for(const [k,v] of financial)lines.push(`  ${k}: ${money(Number(v))}`);lines.push('');}
  if(internal.warnings?.length){lines.push('PRICING CHECKS REQUIRING ATTENTION');for(const w of internal.warnings)lines.push(`  - ${w.message||String(w)}`);lines.push('');}
 }
 lines.push('NEXT STEP',result?.nextStep||'Schedule a consultation to confirm the scope and refine this range.',`Schedule: https://${brand.domain}${brand.consultationPath}`,`Call: ${brand.phone}`,'',admin?'The complete administrative estimate is attached. Do not forward it to the customer.':'Your complete project summary is attached as a PDF.','',result?.disclaimer||'');
 return lines.join('\n');
}
export function estimateEmail(id:string,record:any,admin:boolean){
 // The customer email is never handed anything outside the customer boundary:
 // its message, next step and disclaimer are projected with the sections. The
 // administrative email keeps the saved record and projects only the
 // "as delivered" sections (estimateSections applies the same projection).
 if(!admin)record={...record,customer:customerPresentation(record.customer)};
 const result=record.customer;
 const title=admin?'Internal estimate record':'Your project estimate';
 const subtitle=admin?`Confidential · Reference ${id.slice(0,8)}`:`${brand.name} · Reference ${id.slice(0,8)}`;
 const html=layout(title,subtitle,admin?internalBody(id,record):customerBody(id,result||{},record.contact));
 return {text:plainText(id,record,admin),html};
}
