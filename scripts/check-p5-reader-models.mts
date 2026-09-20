// Compare document-reading models on the same inputs before changing which one
// production uses. Not part of prebuild: it makes paid provider calls (a few
// cents). Prints facts, quantities, exclusions and timing per model so a cheaper
// model is adopted only where its reading matches.
//
//   npx tsx scripts/check-p5-reader-models.mts claude-sonnet-5 claude-haiku-4-5-20251001
import {PDFDocument,StandardFonts} from 'pdf-lib';

const models=process.argv.slice(2);if(!models.length)throw new Error('Name at least one model.');
process.env.P5_SCOPE_PROVIDER='anthropic';
for(const name of ['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL'])delete process.env[name];
const cases:[string,string][]=[
 ['tile','Remove and replace the floor tile in one bathroom with new porcelain tile. Floor only, no shower or wall tile. Please include the tile and setting materials.'],
 ['new-home','New construction in Boise: a two-story single-family home with 3,500 square feet of conditioned living space plus a separate 1,000 square foot attached garage. Premium finishes throughout.'],
 ['cabinet-install','Install 10 linear feet of base cabinets and 10 linear feet of upper cabinets in my kitchen. I am supplying the cabinets, install only. Existing cabinets are already removed.'],
 ['handyman','Adjust three cabinet door hinges and install 20 LF of baseboard that I already bought. Exclude all painting and plumbing.'],
];
async function repairListPdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),page=doc.addPage([612,792]);
 const lines=['RE-10 INSPECTION CONTINGENCY NOTICE - ITEMS TO BE ADDRESSED','1-Chimney Cap','  Repair severe cracking on chimney cap','  Clean bottom of chimney to remove build up on flashing','2-Exterior Venting','  Replace rubber boots for all plumbing vents','3-Interior Venting','  Correct all bathroom exhaust vents to have their own dedicated termination point to the exterior','  Ensure proper weather-proofing is installed on exterior vents','4-Crawl Space','  Remove accumulated debris','  Install vapor barrier','  Insulate floor','5-Electrical','  Replace 4 GFCI receptacles: exterior, kitchen, garage and primary bath','6-Plumbing','  Install vacuum breakers on 2 exterior hose bibs'];
 lines.forEach((line,i)=>page.drawText(line,{x:60,y:730-i*24,size:12,font}));
 return Buffer.from(await doc.save());
}
const summary=(x:any)=>({facts:x.facts.map((f:any)=>`${f.field}=${String(f.value).replace(/\s+/g,' ').slice(0,70)} @${f.confidence} ${f.basis}`).sort(),takeoffs:(x.takeoffs||[]).map((t:any)=>`${String(t.description||t.component).slice(0,60)} | ${t.quantity??''} ${t.unit??''}`).sort(),questions:(x.clarifications||[]).map((c:any)=>`${c.field}: ${c.question}`).sort(),exclusions:x.instructions?.exclusions||[],inclusions:x.instructions?.inclusions||[],laborOnly:x.instructions?.laborOnly,coverage:x.documentCoverage?.pages?.map((p:any)=>p.status)});
const pdf=await repairListPdf();
for(const model of models){
 process.env.P5_SCOPE_FAST_MODEL=model;
 const {analyzeBatch}=await import('../lib/p5/extraction.ts');const {analysisSegments}=await import('../lib/p5/analysisSegments.ts');
 console.log(`\n================ ${model}`);
 for(const [name,text] of cases){const started=Date.now();try{const result:any=await analyzeBatch(text,[],{});console.log(`\n--- ${name} (${((Date.now()-started)/1000).toFixed(1)}s)\n${JSON.stringify(summary(result.extraction),null,1)}`);}catch(error){console.log(`\n--- ${name} FAILED: ${String((error as Error).message).slice(0,200)}`);}}
 const units=[];for await(const unit of analysisSegments({name:'repair-list.pdf',type:'application/pdf',data:pdf}))units.push(unit);
 const started=Date.now();try{const result:any=await analyzeBatch('',[units[0]],{});console.log(`\n--- repair-list PDF page (${((Date.now()-started)/1000).toFixed(1)}s)\n${JSON.stringify(summary(result.extraction),null,1)}`);}catch(error){console.log(`\n--- repair-list PDF FAILED: ${String((error as Error).message).slice(0,200)}`);}
}
