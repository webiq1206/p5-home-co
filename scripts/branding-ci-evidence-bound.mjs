import {lstat,readdir,readFile,writeFile,mkdir,appendFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function packageEvidence({root=process.cwd(),inputs,maxBytes=100*1024*1024}){
 const output=path.join(root,'branding-ci-evidence');await mkdir(output,{recursive:true});
 let bytes=0,count=0;const files=[];
 async function collect(relative){const absolute=path.resolve(root,relative);if(!absolute.startsWith(path.resolve(root)+path.sep))throw new Error('Path outside workspace');const stat=await lstat(absolute);if(stat.isSymbolicLink())throw new Error('Symlink evidence rejected');if(stat.isDirectory()){for(const entry of await readdir(absolute)){if(entry.startsWith('.'))continue;await collect(path.join(relative,entry));}}else if(stat.isFile()){bytes+=stat.size;count++;if(bytes>maxBytes||count>10000)throw new Error('Evidence exceeds bounded size; nothing truncated');files.push(relative);}else throw new Error('Unsupported evidence type');}
 for(const input of inputs){try{await collect(input);}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(!files.length||!bytes)throw new Error('No evidence available');
 if(files.some(f=>/[\r\n]/.test(f)))throw new Error('Unsafe evidence path');
 const list=path.join(output,'files.txt');await writeFile(list,files.join('\n')+'\n');const archive=path.join(output,'complete.tar.gz');
 execFileSync('tar',['-czf',archive,'-T',list],{cwd:root});if((await lstat(archive)).size>maxBytes)throw new Error('Compressed evidence exceeds bound; no upload');
 return archive;
}
// Opt-in artifact group guard. Existing packageEvidence/default CLI callers keep
// their original100MiB behavior. This branch is used only by the four reviewed
// workflows; each invocation represents one original artifact name/path union.
export async function packageEvidenceStrict64({root=process.cwd(),inputs,maxBytes=64*1024*1024}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new Error('Strict artifact cap must be1..64MiB');
 if(!Array.isArray(inputs)||!inputs.length)throw new Error('Evidence input group is missing');
 root=await realpath(path.resolve(root));
 const selected=new Map();
 const unsafe=/[\x00-\x1f\x7f\\]/;
 function checked(relative,{pattern=false}={}){
  if(typeof relative!=='string'||unsafe.test(relative)||path.isAbsolute(relative))throw new Error('Unsafe evidence path');
  const parts=relative.replace(/\/$/,'').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))throw new Error('Unsafe evidence path');
  if(parts[0]!=='test-results')throw new Error('Evidence must stay under test-results');
  if(parts.some((p,i)=>/[?{}\[\]]/.test(p)||((!pattern||i<parts.length-1)&&p.includes('*'))))throw new Error('Unsupported evidence glob');
  return parts.join('/');
 }
 async function safePath(relative,{optional=false}={}){
  let current=root;
  for(const part of relative.split('/')){
   current=path.join(current,part);
   let stat;try{stat=await lstat(current);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
   if(stat.isSymbolicLink())throw new Error('Symlink evidence/output rejected');
  }
  return lstat(current);
 }
 async function collect(relative){
  relative=checked(relative);
  const stat=await safePath(relative);
  if(stat.isDirectory()){
   let matched=0;
   for(const entry of (await readdir(path.join(root,relative))).sort()){
    // Match upload-artifact's existing default exclusion of hidden paths.
    if(!entry.startsWith('.'))matched+=await collect(relative+'/'+entry);
   }
   return matched;
  }
  if(!stat.isFile()||stat.nlink>1)throw new Error('Unsupported evidence file type/link');
  selected.set(relative,stat.size);
  return 1;
 }
 for(const input of inputs){
  const relative=checked(input,{pattern:true}),base=path.posix.basename(relative);
  if(!base.includes('*')){await collect(relative);continue;}
  const directory=path.posix.dirname(relative),stat=await safePath(directory);
  if(!stat.isDirectory())throw new Error('Evidence glob parent is not a directory');
  const expression=new RegExp('^'+base.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s\\S]*')+'$');
  for(const entry of (await readdir(path.join(root,directory))).sort()){
   if(!entry.startsWith('.')&&expression.test(entry))await collect(directory+'/'+entry);
  }
 }
 const files=[...selected.keys()].sort(),bytes=[...selected.values()].reduce((a,b)=>a+b,0);
 if(!files.length||!bytes)throw new Error('No evidence matches the original artifact path union');
 if(bytes>maxBytes||files.length>10000)throw new Error('Evidence exceeds bounded size; nothing truncated');
 // A previous invocation may have left an archive. It can never make this
 // invocation ready, and existing output links must not be followed.
 const output=await safePath('branding-ci-evidence',{optional:true});
 if(output&&!output.isDirectory())throw new Error('Unsafe evidence output directory');
 for(const name of ['files.txt','complete.tar.gz']){
  const stat=await safePath('branding-ci-evidence/'+name,{optional:true});
  if(stat&&(!stat.isFile()||stat.nlink>1))throw new Error('Unsafe evidence output file');
 }
 const archive=await packageEvidence({root,inputs:files,maxBytes});
 const actual=execFileSync('tar',['-tzf',archive],{encoding:'utf8',maxBuffer:8*1024*1024}).trimEnd().split('\n').map(p=>p.replace(/^\.\//,'')).sort();
 if(JSON.stringify(actual)!==JSON.stringify(files))throw new Error('Archive is missing or changed evidence; no upload');
 if((await lstat(archive)).size>maxBytes)throw new Error('Archive exceeds64MiB cap; no upload');
 return archive;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const inputs=process.argv.slice(2);
 if(inputs[0]==='--strict-64m')await packageEvidenceStrict64({inputs:inputs.slice(1)});
 else await packageEvidence({inputs});
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'ready=true\n');
}
