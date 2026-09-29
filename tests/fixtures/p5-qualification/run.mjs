import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {randomUUID, randomBytes} from 'node:crypto';
import {resolve, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Production QA is explicit and P5-only. Never auto-review or auto-submit.
const base = 'https://p5homeco.com';
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const [action, caseId, format = 'text', expectedVersion = '2026-09-29.18'] = process.argv.slice(2);
const test = cases.find(item => item.id === caseId);
if (!test || !['text','txt','pdf','png','scan'].includes(format)) throw new Error('Specify a known case and text/txt/pdf/png/scan format.');
const stateRoot = process.env.P5_QA_STATE_DIR;
if (!stateRoot) throw new Error('Set P5_QA_STATE_DIR outside the repository. It stores private draft keys.');
const root = resolve(stateRoot, `${caseId}-${format}`);
await mkdir(root, {recursive:true, mode:0o700});
const stateFile = resolve(root, 'state.json');
let state;
try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
const save = () => writeFile(stateFile, JSON.stringify(state, null, 2), {mode:0o600});
async function request(route, method='GET', body) {
  const headers = {'x-p5-draft-id':state.id, 'x-p5-draft-key':state.key};
  if(method !== 'GET') headers.origin = base;
  if(body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}/api/p5-estimator/${route}`, {method,headers,body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(180000)});
  const data = await response.json();
  await writeFile(resolve(root, `${Date.now()}-${action}.json`), JSON.stringify({at:new Date().toISOString(), release:state.release,status:response.status,data},null,2), {mode:0o600});
  if(data.draft) {state.draft=data.draft;await save();}
  const extraction = state.draft?.extraction;
  console.log(JSON.stringify({case:caseId,format,http:response.status,id:state.id,revision:state.draft?.revision,status:state.draft?.status,pending:data.pending,submission:data.submission,error:data.error,message:data.message,questions:data.questions,conflicts:data.conflicts,answers:state.draft?.answers,extraction,events:data.events?.slice(0,5),result:data.result},null,2));
  if(!response.ok) throw new Error(`HTTP ${response.status}; receipt retained. Do not automatically retry mutations.`);
  return data;
}
async function releaseGuard() {
  const response=await fetch(`${base}/api/p5-estimator/release`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Release HTTP ${response.status}`);
  const release=await response.json();
  if(release.version!==expectedVersion) throw new Error(`Expected ${expectedVersion}, live ${release.version}; no mutation made.`);
  return release;
}
if(action === 'start') {
  if(state) throw new Error('Existing QA draft retained. Inspect/finalize it; do not create duplicate paid work.');
  let upload;
  if(format!=='text') {
    upload=fileURLToPath(new URL(`./fixtures/${caseId}.${format==='scan'?'scan.pdf':format}`,import.meta.url));
    await access(upload);
  }
  const release=await releaseGuard();
  state={id:randomUUID(),key:randomBytes(32).toString('hex'),caseId,format,release,createdAt:new Date().toISOString(),upload};
  await save();
  await request('draft','PUT',{revision:0,text:format==='text'?test.scope:'Please estimate only the scope in the attached synthetic QA document for Boise, Idaho.',answers:{service:test.service,location:'Boise, Idaho'},contact:{name:`[QA] P5 ${test.title}`.slice(0,120),email:'brostjared@gmail.com',phone:''},wizard:{skipped:[],resolutions:{}},reviewed:false});
} else {
  if(!state?.draft) throw new Error('No saved draft.');
  if(action==='inspect') await request('draft?events=1');
  else if(action==='analyze'||action==='finalize') {
    await releaseGuard();
    const form=new FormData();
    form.set('text',state.draft.text);form.set('revision',String(state.draft.revision));form.set('resumable','true');form.set('background','true');
    if(state.upload && !state.draft.uploads?.length) {
      const type=format==='txt'?'text/plain':format==='png'?'image/png':'application/pdf';
      form.append('files',new Blob([await readFile(state.upload)],{type}),basename(state.upload));
    }
    await request('scope','POST',form);
  } else if(action==='review') {
    if(process.env.P5_QA_REVIEW_CONFIRMED!==`${caseId}-${format}`) throw new Error('Manually inspect scope/questions and set P5_QA_REVIEW_CONFIRMED to this case-format before review.');
    await releaseGuard();
    await request('draft','PUT',{revision:state.draft.revision,text:state.draft.text,answers:state.draft.answers,contact:state.draft.contact,wizard:state.draft.wizard,reviewed:true});
  } else if(action==='submit') {
    if(!state.draft.reviewed) throw new Error('Not reviewed.');
    await releaseGuard();
    await request('submit','POST',{revision:state.draft.revision,background:true,notify:false});
  } else throw new Error('Unknown action.');
}
