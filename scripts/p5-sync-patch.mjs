// Reconcile reviewed canonical hunks without replacing a brand's divergent engine.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const ALLOWED=new Set(['components/P5Estimator.tsx','lib/p5/intakePolicy.ts','lib/p5/theme.ts']);
const digest=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const git=(root,args,input)=>execFileSync('git',args,{cwd:root,encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
function safe(root,file){if(!ALLOWED.has(file))throw Error('Unapproved patch file');const full=path.join(root,file);for(let p=full;p!==root;p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Symlink rejected');return full;}
export function syncPatch({source,target,sourceBase,sourceHead,targetBase,targetCurrent,files,dry=false}){
 source=fs.realpathSync(source);target=fs.realpathSync(target);if(source===target)throw Error('Distinct repositories required');
 if(JSON.parse(fs.readFileSync(path.join(source,'package.json'))).name!=='p5-home-co-nextjs')throw Error('Canonical source required');
 for(const ref of [sourceBase,sourceHead,targetBase,targetCurrent])if(!/^[a-f0-9]{40}$/.test(ref))throw Error('Exact commit required');
 if(!files.length||new Set(files).size!==files.length)throw Error('Explicit unique files required');
 const manifestPath=path.join(target,'lib/p5/shared-manifest.json');if(fs.lstatSync(manifestPath).isSymbolicLink())throw Error('Manifest symlink rejected');
 const manifest=JSON.parse(fs.readFileSync(manifestPath)),canonical=JSON.parse(git(source,['show',`${sourceHead}:lib/p5/shared-manifest.json`]));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'p5-selected-patch-'));const plans=[];
 try{for(const file of files){const full=safe(target,file);safe(source,file);const from=git(source,['show',`${sourceHead}:${file}`]);if(digest(from)!==canonical.files[file])throw Error('Canonical manifest mismatch');
  const base=git(target,['show',`${targetBase}:${file}`]),current=git(target,['show',`${targetCurrent}:${file}`]);if(digest(base)!==manifest.files[file])throw Error('Target baseline does not match manifest');
  if(fs.readFileSync(full,'utf8').replace(/\r\n/g,'\n')!==current.replace(/\r\n/g,'\n'))throw Error('Unreviewed target working change');
  const patch=git(source,['diff','--no-ext-diff','--no-renames',sourceBase,sourceHead,'--',file]);if(!patch||patch.includes('GIT binary patch')||patch.includes('new file mode')||patch.includes('deleted file mode'))throw Error('Only existing text-file hunks allowed');
  const temporary=path.join(temp,file);fs.mkdirSync(path.dirname(temporary),{recursive:true});fs.writeFileSync(temporary,base);
  git(temp,['apply','--check','-'],patch);git(temp,['apply','-'],patch);const result=fs.readFileSync(temporary,'utf8');
  plans.push({file,before:digest(base),reviewedCursor:digest(current),after:digest(result),patchSha256:digest(patch),result});
 }
 const receipt={source:'p5-home-co',sourceBase,sourceHead,targetBase,targetCurrent,files:plans.map(({result,...p})=>p),note:'Only canonical diff hunks applied to the recorded brand baseline. Reviewed Cursor changes are reconciled explicitly; unrelated target-engine code is preserved.'};
 if(!dry){for(const p of plans)fs.writeFileSync(safe(target,p.file),p.result);for(const p of plans)manifest.files[p.file]=p.after;manifest.selectivePatchBatches=[...(manifest.selectivePatchBatches||[]),receipt];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');}return receipt;
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const options=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(syncPatch(options),null,2));}
