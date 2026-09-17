import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {parsePdf} from '../src/parser.mjs';
async function fixture(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([612,792]).drawText('Controlled source. Living area 2400 SF.',{x:40,y:700,font,size:12});return Buffer.from(await pdf.save());}
test('slow manifest persistence finishes before any page checkpoint or completion',async()=>{
 const events=[];await parsePdf(await fixture(),{onManifest:async count=>{events.push('manifest-start');await new Promise(r=>setTimeout(r,1000));assert.equal(count,1);events.push('manifest-saved');},onPage:async p=>{assert.equal(p.page,1);assert.deepEqual(events,['manifest-start','manifest-saved']);await new Promise(r=>setTimeout(r,50));events.push('page-saved');}});
 assert.deepEqual(events,['manifest-start','manifest-saved','page-saved']);
});
test('a failed manifest write rejects preparation instead of falsely completing',async()=>{
 let pages=0;await assert.rejects(parsePdf(await fixture(),{onManifest:async()=>{await new Promise(r=>setTimeout(r,100));throw Error('controlled-storage-failure');},onPage:()=>pages++}),/controlled-storage-failure/);assert.equal(pages,0);
});
