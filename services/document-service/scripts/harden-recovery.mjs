import fs from 'node:fs';
const root=new URL('../',import.meta.url);
function change(file,from,to){const url=new URL(file,root),text=fs.readFileSync(url,'utf8');if(text.includes(to))return;if(!text.includes(from))throw new Error('Recovery integration point changed: '+file);fs.writeFileSync(url,text.replace(from,to));}
change('src/store.mjs',"UPDATE p5ds_documents SET state='parsing',updated_at=now() WHERE id=$1","UPDATE p5ds_documents SET state=CASE WHEN state='failed' THEN state ELSE 'parsing' END,updated_at=now() WHERE id=$1");
change('src/pipeline.mjs',
 "  const stored=await this.store.pages(job.document_id,job.payload.pages,true);\n  if(stored.length!==job.payload.pages.length)throw new ServiceError('missing-prepared-page',503);\n  if(stored.every(p=>p.evidence)){await this.store.complete(job,{cached:true});await this.finalize(job.document_id);return;}",
 "  const requested=await this.store.pages(job.document_id,job.payload.pages,true);\n  if(requested.length!==job.payload.pages.length)throw new ServiceError('missing-prepared-page',503);\n  const stored=requested.filter(p=>!p.evidence);\n  if(!stored.length){await this.store.complete(job,{cached:true});await this.finalize(job.document_id);return;}");
change('src/pipeline.mjs','UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2','UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2 AND evidence IS NULL');
console.log('Recovery preserves terminal failures and already verified page evidence.');
