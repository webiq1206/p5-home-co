import {lstat,readdir,readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
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
if(process.argv[1]===fileURLToPath(import.meta.url)){await packageEvidence({inputs:process.argv.slice(2)});if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'ready=true\n');}
