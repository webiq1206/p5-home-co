import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {transferLargeFiles} from '../lib/p5/resumableTransfer.ts';
import {BROWSER_DRAFT_RECOVERY_KEY,DEVICE_CACHE_LIMIT,loadBrowserDraft,newBrowserDraft,persistBrowserDraft,cacheFiles,loadCachedFiles,validateCacheSelection,missingPendingFiles,listBrowserDraftRecoveries,restoreBrowserDraft} from '../lib/p5/browserDraft.ts';
import {SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_CHUNK_SIZE,validateAnswer} from '../lib/p5/scope.ts';

// Pure tests: any unintended provider, session, CRM or database HTTP call fails.
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{throw new Error('Non-fixture network forbidden');};});
test.after(()=>{globalThis.fetch=realFetch;});
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

test('reload retains incomplete manual numbers, typed reply, conflicts and complete mixed saved upload metadata',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  try{
    const draft={...newBrowserDraft(''),text:'Keep Bosch fixtures. Exclude painting; plans contradict the spreadsheet quantity.',answers:{sqft:'1,',estimatingInstructions:'Labor only. Preserve owner-supplied materials.'},conflicts:[{field:'sqft' as const,values:['120','180'],explanation:'Plan and spreadsheet disagree.'}],pendingReply:{id:'manual-question',answer:'Keep all exclusions, not just the first.'},uploads:['plan.pdf','site.jpg','scope.xlsx'].map((name,index)=>({id:`fixture-${index}`,name,type:'fixture',size:index+1,sha256:String(index).repeat(64),status:'stored' as const}))};
    assert.ok(persistBrowserDraft(draft));
    const restored=loadBrowserDraft('');
    assert.equal(restored.id,draft.id);
    assert.equal(restored.text,draft.text);
    assert.deepEqual(restored.answers,draft.answers);
    assert.deepEqual(restored.pendingReply,draft.pendingReply);
    assert.deepEqual(restored.uploads,draft.uploads);
    assert.deepEqual(restored.conflicts,draft.conflicts);
    assert.ok(validateAnswer('sqft',restored.answers.sqft!),'recovery must not weaken submission validation');
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('legacy source drafts migrate only to the matching identity and recoveries stay source-isolated',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  try{
    const legacy={...newBrowserDraft(''),text:'Kitchen design A',projectSource:{id:'design-a',answers:{service:'kitchen' as const}},answers:{service:'kitchen' as const}};
    values.set('p5-project-draft-v2',JSON.stringify(legacy));
    const unrelated=loadBrowserDraft('bathroom','design-b');
    assert.notEqual(unrelated.id,legacy.id);
    assert.equal(values.get('p5-project-draft-v2'),JSON.stringify(legacy),'an unrelated route must not consume the legacy draft');
    const migrated=loadBrowserDraft('','design-a');
    assert.equal(migrated.id,legacy.id);
    assert.equal(migrated.namespace,'design-a');
    assert.equal(values.has('p5-project-draft-v2'),false);
    assert.ok(values.has('p5-project-draft-v2:design-a'));

    const generic={...newBrowserDraft(''),text:'Generic project'};
    const sourceA={...legacy,namespace:'design-a'};
    const sourceB={...newBrowserDraft(''),namespace:'design-b',text:'Design B'};
    const mixed={...legacy,namespace:'design-b',text:'Conflicting source identities'};
    const records=[generic,sourceA,sourceB,mixed].map((draft,index)=>({key:`recovery-${index}`,archivedAt:index,draft}));
    values.set(BROWSER_DRAFT_RECOVERY_KEY,JSON.stringify(records));
    assert.deepEqual(listBrowserDraftRecoveries().map(r=>r.key),['recovery-0']);
    assert.deepEqual(listBrowserDraftRecoveries('design-a').map(r=>r.key),['recovery-1']);
    assert.equal(listBrowserDraftRecoveries('design-b').some(r=>r.key==='recovery-3'),false);
    assert.equal(restoreBrowserDraft('recovery-2')?.text,'Design B','key restoration remains available independent of listing filters');
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('file recovery reads only the active draft and never returns a partial readable subset',async()=>{
  const previousDb=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const previousRange=Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange');
  let records:any[]=[{draftId:'fixture',name:'plan.pdf',bytes:new Uint8Array([1,2,3]).buffer,size:3}];
  let closed=0;
  Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound:(lower:string,upper:string)=>({lower,upper})}});
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:()=>{
    const open:any={};
    queueMicrotask(()=>{
      open.result={close:()=>closed++,transaction:()=>{
        const tx:any={abort:()=>{},objectStore:()=>({openCursor:(range:unknown)=>{
          assert.deepEqual(range,{lower:'fixture:',upper:'fixture:\uffff'});
          const read:any={};let index=0;
          const next=()=>queueMicrotask(()=>{read.result=index<records.length?{value:records[index++],continue:next}:null;read.onsuccess();if(!read.result)tx.oncomplete();});
          next();return read;
        }})};return tx;
      }};
      open.onsuccess();
    });return open;
  }}});
  try{
    const files=await loadCachedFiles('fixture');
    assert.equal(files.length,1);assert.deepEqual(Array.from(new Uint8Array(await files[0].arrayBuffer())),[1,2,3]);
    records=[...records,{draftId:'fixture',name:'scope.xlsx',bytes:new Uint8Array([4]).buffer,size:9}];
    await assert.rejects(loadCachedFiles('fixture'),/could not be fully recovered/);
    records=[records[0],{draftId:'fixture',name:'photo.jpg'}];
    await assert.rejects(loadCachedFiles('fixture'),/could not be fully recovered/);
    assert.equal(closed,3);
  }finally{
    if(previousDb)Object.defineProperty(globalThis,'indexedDB',previousDb);else Reflect.deleteProperty(globalThis,'indexedDB');
    if(previousRange)Object.defineProperty(globalThis,'IDBKeyRange',previousRange);else Reflect.deleteProperty(globalThis,'IDBKeyRange');
  }
});

test('selection metadata admits 250 MiB files and the exact 1 GiB batch',()=>{
  assert.doesNotThrow(()=>validateCacheSelection([{size:250*1024*1024}]));
  assert.doesNotThrow(()=>validateCacheSelection([...Array.from({length:4},()=>({size:SCOPE_FILE_LIMIT})),{size:SCOPE_BATCH_LIMIT-4*SCOPE_FILE_LIMIT}]));
  assert.throws(()=>validateCacheSelection([{size:SCOPE_FILE_LIMIT+1}]),/250 MiB/);
  assert.throws(()=>validateCacheSelection(Array.from({length:5},()=>({size:SCOPE_FILE_LIMIT}))),/1 GiB/);
  assert.throws(()=>validateCacheSelection(Array.from({length:51},()=>({size:1}))),/50 files/);
  assert.doesNotThrow(()=>validateCacheSelection([]),'clearing the cache remains valid');
});

test('the device recovery copy keeps its own memory budget and refuses before reading any bytes',async()=>{
  assert.equal(DEVICE_CACHE_LIMIT,22*1024*1024);
  const large={name:'250-page-plan.pdf',size:DEVICE_CACHE_LIMIT+1,lastModified:1,type:'application/pdf',arrayBuffer(){throw new Error('Must not read');},slice(){throw new Error('Must not read');}} as unknown as File;
  await assert.rejects(cacheFiles('fixture-budget',[large]),/Large files stay in this tab/);
  // The refused selection is still named, so a reload asks for the original instead of losing it.
  assert.deepEqual(missingPendingFiles({pendingFiles:[{name:large.name,size:large.size}]},[]),[{name:large.name,size:large.size}]);
});

test('missing original files remain identifiable after quota failure and partial reselection',()=>{
  const pendingFiles=[{name:'250-page-plan.pdf',size:SCOPE_FILE_LIMIT},{name:'site.jpg',size:100},{name:'scope.xlsx',size:200}];
  const draft={pendingFiles};
  assert.deepEqual(missingPendingFiles(draft,[]),pendingFiles);
  assert.deepEqual(missingPendingFiles(draft,pendingFiles.slice(1)),pendingFiles.slice(0,1));
  assert.deepEqual(missingPendingFiles(draft,[{name:'250-page-plan.pdf',size:1},...pendingFiles.slice(1)]),pendingFiles.slice(0,1));
  assert.deepEqual(missingPendingFiles(draft,pendingFiles),[]);
});

test('a truncated upload segment cannot receive a finish receipt',async()=>{
  const file=new File(['complete source'],'plan.pdf');
  Object.defineProperty(file,'slice',{value:()=>new Blob(['cut'])});
  let requests=0;
  const fixture:typeof fetch=async(input)=>{requests++;assert.match(String(input),/action=start/);return json({chunkSize:SCOPE_CHUNK_SIZE,chunks:{},complete:false});};
  await assert.rejects(transferLargeFiles([file],{},()=>{},fixture),/segment was not fully read/);
  assert.equal(requests,1);
});

test('partial file reads are rejected before caching or sending any bytes',async()=>{
  const file=new File(['whole source'],'scope.xlsx');
  Object.defineProperty(file,'arrayBuffer',{value:async()=>new ArrayBuffer(2)});
  await assert.rejects(cacheFiles('fixture',[file]),/not fully read/);
});

test('selection limits and cancellation are enforced before any file data is read or sent',async()=>{
  const unread=(size:number)=>({name:'plan.pdf',size,slice(){throw new Error('Must not read');},arrayBuffer(){throw new Error('Must not read');}}) as unknown as File;
  await assert.rejects(transferLargeFiles([],{},()=>{}),/50 files/);
  await assert.rejects(transferLargeFiles([unread(0)],{},()=>{}),/250 MiB/);
  await assert.rejects(transferLargeFiles(Array.from({length:51},()=>unread(1)),{},()=>{}),/50 files/);
  await assert.rejects(transferLargeFiles(Array.from({length:5},()=>unread(SCOPE_FILE_LIMIT)),{},()=>{}),/1 GiB/);
  const controller=new AbortController();let requests=0;
  const cancelled:typeof fetch=async()=>{requests++;controller.abort();throw new DOMException('Aborted','AbortError');};
  await assert.rejects(transferLargeFiles([new File(['scope'],'scope.txt')],{},()=>{},cancelled,controller.signal),{name:'AbortError'});
  assert.equal(requests,1,'a customer cancellation is never retried');
});

test('250 MiB boundary transfers every byte including the last partial segment',async()=>{
  const bytes=new Uint8Array(SCOPE_FILE_LIMIT);
  for(let offset=0;offset<bytes.length;offset+=SCOPE_CHUNK_SIZE)bytes[offset]=(offset/SCOPE_CHUNK_SIZE+1)%256;
  bytes[bytes.length-1]=217;
  const file=new File([bytes],'250-page-plan.pdf');
  const expectedHash=sha(bytes);let received=0;let parts=0;const reconstructed=createHash('sha256');
  const progress:number[]=[];
  const request:typeof fetch=async(input,init)=>{
    const url=new URL(String(input),'http://fixture.invalid');
    assert.equal(url.searchParams.get('sha256'),expectedHash);
    switch(url.searchParams.get('action')){
      case 'start': assert.deepEqual(JSON.parse(String(init?.body)),{name:file.name,size:SCOPE_FILE_LIMIT});return json({chunkSize:SCOPE_CHUNK_SIZE,chunks:{},complete:false});
      case 'part': {
        const data=init?.body as Uint8Array;
        assert.equal(Number(url.searchParams.get('part')),parts);
        assert.equal(data.byteLength,Math.min(SCOPE_CHUNK_SIZE,SCOPE_FILE_LIMIT-received));
        assert.equal(sha(data),url.searchParams.get('checksum'));
        reconstructed.update(data);received+=data.byteLength;parts++;
        return json({part:parts-1,checksum:sha(data)});
      }
      case 'finish': assert.equal(received,SCOPE_FILE_LIMIT);assert.equal(reconstructed.digest('hex'),expectedHash);return json({draft:{revision:1,answers:{},uploads:[{sha256:expectedHash,size:received}]}});
      default:throw new Error('Non-fixture endpoint');
    }
  };
  await transferLargeFiles([file],{},value=>progress.push(value),request);
  assert.equal(parts,Math.ceil(SCOPE_FILE_LIMIT/SCOPE_CHUNK_SIZE));
  assert.equal(progress.at(-1),99);
  assert.ok(progress.every((value,index)=>value<=99&&(!index||value>=progress[index-1])));
  const oversized=new File(['x'],'too-large.pdf');Object.defineProperty(oversized,'size',{value:SCOPE_FILE_LIMIT+1});
  await assert.rejects(transferLargeFiles([oversized],{},()=>{}),/250 MiB/);
});

test('mixed files resume matching segments, retry HTML gateway failure, and require cumulative receipt',async()=>{
  const files=[new File(['PDF fixture'],'plan.pdf'),new File(['photo fixture'],'site.jpg'),new File(['XLSX fixture'],'scope.xlsx')];
  const hashes=await Promise.all(files.map(async f=>sha(new Uint8Array(await f.arrayBuffer()))));
  let starts=0;let parts=0;let finishes=0;let failFinal=false;
  const request:typeof fetch=async(input)=>{
    const url=new URL(String(input),'http://fixture.invalid');const index=hashes.indexOf(url.searchParams.get('sha256')!);assert.ok(index>=0);
    const action=url.searchParams.get('action');
    if(action==='start'){
      if(starts++===0)return new Response('<html>Bad gateway</html>',{status:502});
      return json({chunkSize:SCOPE_CHUNK_SIZE,chunks:{0:hashes[index]},complete:false});
    }
    if(action==='part'){parts++;throw new Error('Acknowledged segments must not be resent');}
    assert.equal(action,'finish');finishes++;
    return json({draft:{revision:finishes,answers:{},uploads:files.slice(failFinal&&index===2?2:0,index+1).map(f=>({sha256:hashes[files.indexOf(f)],size:f.size}))}});
  };
  const result=await transferLargeFiles(files,{},()=>{},request) as any;
  assert.equal(result.draft.uploads.length,3);assert.equal(parts,0);assert.equal(finishes,3);
  failFinal=true;
  await assert.rejects(transferLargeFiles(files,{},()=>{},request),/plan.pdf: upload was not confirmed/);
});