// Synthetic process fixture: no PDF, provider or external app access.
import {writeFileSync} from 'node:fs';
process.send({type:'boot'});
process.on('disconnect',()=>process.exit(0));
process.on('message',request=>{
 if(request.pidFile)writeFileSync(request.pidFile,String(process.pid));
 if(request.fault==='exit')process.exit(17);
 if(request.fault==='respond'){process.send({type:'manifest',count:1});process.send({type:'page',value:{pid:process.pid}});process.send({type:'done'});return;}
 if(request.fault==='wasm'){const memory=new WebAssembly.Memory({initial:1,maximum:16});process.send({type:'manifest',count:1});process.send({type:'page',value:{bytes:memory.buffer.byteLength}});process.send({type:'done'});return;}
 if(request.fault==='memory'){
  const buffers=[];let n=0;
  const allocate=()=>{buffers.push(Buffer.alloc(8*1024*1024,1));process.send({type:'native',value:{rss:process.memoryUsage().rss}});if(++n<80)setImmediate(allocate);else process.send({type:'done'});};allocate();return;
 }
 setInterval(()=>{},1000);
});
