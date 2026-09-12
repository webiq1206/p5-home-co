import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),output=path.join(root,'node_modules/.cache/p5-progress-preview');await mkdir(output,{recursive:true});
await build({entryPoints:['tests/fixtures/p5-progress-preview.tsx'],bundle:true,outdir:output,entryNames:'preview',format:'esm',jsx:'automatic',alias:{'@':root},define:{'process.env.NODE_ENV':'"development"'}});
createServer(async(req,res)=>{
  const name=req.url?.split('?')[0];
  if(name==='/preview.js'||name==='/preview.css'){res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/javascript');res.end(await readFile(path.join(output,name.slice(1))));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><title>P5 loading screen development preview</title></head><body style="margin:0;background:#17221b;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
}).listen(4173,'0.0.0.0',()=>console.log('Development-only progress preview listening on port 4173. Simulated status, no customer records or external services.'));
