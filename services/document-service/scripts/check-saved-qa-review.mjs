// Only the owner's existing synthetic QA review. No upload, PDF reread or email.
// Run after pulling and republishing the reviewed P5 release.
import {signedHeaders} from '../src/core.mjs';

const tenant='p5homeco.com';
const base='https://p5homeco.com/api/p5-documents';
const path='/v1/projects/p5-qa-1789704249953/reviews/d331348c215480aeb7464fa574ef0d2c3d2cb7c1a90e5def5030b84b4d470ea9';
const deadline=Date.now()+180000;
const code=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/.test(value)?value:'unavailable';

try {
 let key;
 try {key=JSON.parse(process.env.P5_DOCUMENT_TENANTS_JSON||'{}')[tenant];}
 catch {throw Error('The tenant configuration is not valid JSON.');}
 if(typeof key!=='string'||key.length<32)throw Error('The P5 website key is unavailable.');
 const request=async(method,endpoint)=>{
  const response=await fetch(base+endpoint,{method,headers:signedHeaders(key,method,endpoint,tenant),signal:AbortSignal.timeout(20000),redirect:'error'});
  let result;try {result=await response.json();}catch {throw Error(`HTTP ${response.status}: response was not JSON.`);}
  if(!response.ok)throw Error(`HTTP ${response.status}: ${code(result.error)}.`);
  return result;
 };
 let result=await request('GET',path);
 if(result.state==='failed'){
  await request('POST',path+'/retry');
  console.log('Saved synthetic review queued once. The PDF will not be uploaded or reread.');
  result=await request('GET',path);
 }
 let previous;
 while(!['complete','failed'].includes(result.state)){
  if(Date.now()>=deadline)throw Error('Still running. No further retry was sent; run this check later to inspect it.');
  if(result.state!==previous){console.log('State:',code(result.state));previous=result.state;}
  await new Promise(resolve=>setTimeout(resolve,3000));
  result=await request('GET',path);
 }
 if(result.state==='failed')throw Error(`Saved review failed: ${code(result.error)}. Source evidence is still saved.`);
 console.log('PASS: The deployed saved synthetic review completed.');
 console.log(JSON.stringify(result,null,2));
 console.log('Inspect 120 lf baseboard, 4 doors, missing door dimensions and plumbing/electrical exclusions.');
 console.log('This does not verify customer pricing, PDF/email delivery, all-site activation or performance targets.');
} catch(error) {
 const message=['TimeoutError','AbortError'].includes(error.name)?'Request timed out; the saved review may still be running.':error instanceof TypeError?'Connection or response failed.':error.message;
 console.error('Check stopped:',message);
 process.exitCode=1;
}
