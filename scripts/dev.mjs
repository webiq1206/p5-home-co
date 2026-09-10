import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const args=process.argv.slice(2).filter(arg=>arg!=='--strictPort').map(arg=>arg==='--host'?'--hostname':arg);
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev',...args],{stdio:'inherit',env:process.env});
child.on('exit',code=>process.exit(code||0));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
