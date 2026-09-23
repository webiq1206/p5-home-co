import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateLinkToken,verifyEstimateLink,estimateLinkUrl} from '../lib/p5/estimateLinks.ts';
import {driveToken,validDriveToken} from '../lib/p5/estimateDriver.ts';
import {projectMaterials,stageTitle,remainingRange,remainingLabel,type ProcessingStatus} from '../lib/p5/processingStatus.ts';

// Owner request 2026-09-22: estimates run as background jobs that survive a closed page, progress is
// honest and names only the materials provided, and an emailed link opens exactly that estimate.
const ID='0f1e2d3c-4b5a-4000-8000-00000000abcd',OTHER='1f1e2d3c-4b5a-4000-8000-00000000abcd';
process.env.DATABASE_URL||='postgres://test-only/secret';
test('a signed estimate link opens only its own estimate, and only until it expires',()=>{
  const now=Date.parse('2026-09-22T12:00:00Z');const token=estimateLinkToken(ID,now,30);
  assert.equal(verifyEstimateLink(ID,token,now),true);
  assert.equal(verifyEstimateLink(OTHER,token,now),false,'another customer\'s estimate id fails');
  const [stamp,sig]=token.split('.');
  assert.equal(verifyEstimateLink(ID,`${stamp}.${sig.slice(0,-1)}${sig.endsWith('A')?'B':'A'}`,now),false,'a changed signature fails');
  assert.equal(verifyEstimateLink(ID,`${(parseInt(stamp,36)+86400).toString(36)}.${sig}`,now),false,'a stretched expiry fails');
  assert.equal(verifyEstimateLink(ID,token,now+31*86400*1000),false,'an expired link fails');
  assert.equal(verifyEstimateLink(ID,'not-a-token',now),false);
  assert.match(estimateLinkUrl(ID,now),/^https:\/\/[a-z0-9.-]+\/estimate\/scope\?estimate=0f1e2d3c-[^&]+&t=[0-9a-z]+\.[A-Za-z0-9_-]{32}$/);
});
test('only the server\'s own signed request may drive the queue',()=>{
  assert.equal(validDriveToken(driveToken()),true);
  assert.equal(validDriveToken(null),false);assert.equal(validDriveToken('x'.repeat(64)),false);
});
const at=(phase:ProcessingStatus['phase'],extra:Partial<ProcessingStatus>={}):ProcessingStatus=>({phase,message:'',updatedAt:'',...extra});
test('scenario A: a typed or dictated description never mentions uploads',()=>{
  const m=projectMaterials([],'Replace the shower and paint the bathroom.');
  for(const phase of ['queued','preparing','reading','cross-referencing','inventory','mapping','research','verification'] as const)
    assert.doesNotMatch(stageTitle(at(phase),m),/photo|plan|document|specification|file|upload|page/i,phase);
  assert.equal(stageTitle(at('reading'),m),'Reviewing your project details');
});
test('scenario B: photos, plans, specifications and other PDFs are named only when present and being read',()=>{
  assert.equal(stageTitle(at('reading'),projectMaterials([{name:'IMG_2031.jpg',type:'image/jpeg'}])),'Reviewing your photos');
  const pdf=projectMaterials([{name:'Inspection notice.pdf',type:'application/pdf'}]);
  assert.equal(stageTitle(at('reading'),pdf),'Reviewing your documents','a PDF is not assumed to be plans');
  assert.equal(stageTitle(at('reading',{currentItems:['Inspection notice.pdf (original page 3; detail regions 1 of 6)']}),pdf),'Reviewing your plans','drawing sheets reported by the reader are plans');
  assert.equal(stageTitle(at('reading'),projectMaterials([{name:'Project Specifications Div 09.pdf',type:'application/pdf'}])),'Reviewing your specifications');
  assert.equal(stageTitle(at('inventory'),pdf),'Building the scope of work');
  assert.equal(stageTitle(at('cross-referencing'),pdf),'Calculating quantities');
  assert.equal(stageTitle(at('mapping'),pdf),'Applying pricing');
  assert.equal(stageTitle(at('verification'),pdf),'Checking your estimate');
});
test('the time range follows the actual workload and shrinks as work finishes; past it, it says so',()=>{
  const docs=projectMaterials([{name:'set.pdf',type:'application/pdf'}]);
  const many=remainingRange(at('reading',{totalPages:48,readPages:0}),docs,'analysis')!;
  const fewer=remainingRange(at('reading',{totalPages:48,readPages:36}),docs,'analysis')!;
  assert.ok(many.high>fewer.high,'fewer pages left, less time left');
  const text=remainingRange(at('reading'),projectMaterials([],'Paint two rooms.'),'analysis')!;
  assert.ok(text.high<=40,'a typed description is quick');
  const early=remainingRange(at('inventory'),docs,'pricing')!,late=remainingRange(at('verification'),docs,'pricing')!;
  assert.ok(early.high>late.high,'later pricing stages leave less');
  assert.match(remainingLabel({low:90,high:240}),/^About 2 to 4 minutes left$/);
  assert.equal(remainingLabel({low:10,high:40}),'Less than a minute left');
  assert.match(remainingLabel({low:90,high:240},true),/Taking longer than usual/);
  assert.doesNotMatch(remainingLabel({low:90,high:240}),/%/,'never a percentage');
});
test('a revision keeps the request in the description and says what changed from the prior version',async()=>{
  const {revisedDescription,changeSummary}=await import('../lib/p5/estimateRevisions.ts');
  assert.equal(revisedDescription('Remodel the hall bath.','Remove painting',2),'Remodel the hall bath.\n\nRequested change for revision 3: Remove painting');
  const before={change:'Remove painting',customer:{range:{low:22800,high:31300},scopeTasks:[{description:'Tile the shower'},{description:'Paint the bathroom'}]}};
  const after={range:{low:21000,high:29000},scopeTasks:[{description:'Tile the shower'}]};
  assert.deepEqual(changeSummary(before,after),['Requested change: Remove painting','Total was $22,800 to $31,300; now $21,000 to $29,000.','Removed: Paint the bathroom.']);
  assert.deepEqual(changeSummary(undefined,after),[],'a first version has nothing to compare');
});
