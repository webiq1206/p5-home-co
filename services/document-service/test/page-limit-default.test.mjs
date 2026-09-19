import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {parsePdf} from '../src/parser.mjs';
import {readConfig} from '../src/core.mjs';

test('default reader configuration and real parser admit 250 pages and reject 251 before reading',async()=>{
 const config=readConfig({P5_DOCUMENT_TENANTS_JSON:JSON.stringify({qa:'synthetic-key'.repeat(4)}),DOCUMENT_DATABASE_URL:'isolated-test-only',DOCUMENT_MODEL:'claude-sonnet-5',ANTHROPIC_API_KEY:'synthetic-no-network'});
 assert.equal(config.maxPages,250);
 const pdf=await PDFDocument.create();
 for(let i=1;i<=250;i++)pdf.addPage([240,240]).drawText('Synthetic page '+i,{size:10,x:10,y:120});
 const seen=[];let manifest;
 await parsePdf(Buffer.from(await pdf.save()),{onManifest:n=>{manifest=n;},onPage:p=>{assert.ok(p.text.includes('Synthetic page '+p.page));assert.ok(p.image.length);seen.push(p.page);}});
 assert.equal(manifest,250);assert.deepEqual(seen,Array.from({length:250},(_,i)=>i+1));
 pdf.addPage([240,240]);let emitted=false;
 await assert.rejects(parsePdf(Buffer.from(await pdf.save()),{onManifest:()=>{emitted=true;},onPage:()=>{emitted=true;}}),/page-limit-exceeded/);
 assert.equal(emitted,false);
});
