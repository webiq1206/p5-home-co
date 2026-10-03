import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function rendererBuildCommands(cwd=process.cwd(),platform=process.platform){
 const directory=join(cwd,'.p5-renderer'),python=join(directory,platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');
 return [[platform==='win32'?'python':'python3',['-m','venv',directory]],
  [python,['-I','-m','pip','install','--no-cache-dir','--only-binary=:all:','--no-deps','--require-hashes','-r',join(cwd,'services/document-service/requirements-renderer.txt')]],
  [python,['-I','-B',join(cwd,'services/document-service/src/pdfium-render.py'),'--probe']]];
}
export function buildRenderer(cwd=process.cwd(),run=spawnSync){
 for(const [command,args] of rendererBuildCommands(cwd)){
  const result=run(command,args,{cwd,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw Error('Pinned renderer build/probe failed');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))buildRenderer();
