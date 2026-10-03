// Synthetic process fixture: no PDF, provider or external app access.
import {writeFileSync} from 'node:fs';
process.send({type:'boot'});
process.once('message',request=>{
 if(request.pidFile)writeFileSync(request.pidFile,String(process.pid));
 if(request.fault==='exit')process.exit(17);
 setInterval(()=>{},1000);
});
