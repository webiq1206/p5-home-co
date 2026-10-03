import pg from 'pg';
import {readConfig,VERSION} from './core.mjs';
import {Store} from './store.mjs';
import {Reader} from './provider.mjs';
import {Pipeline} from './pipeline.mjs';
import {makeServer} from './server.mjs';
import {checkRendererRuntime} from './renderer-runtime.mjs';
const config=readConfig();
// Fail startup/readiness before accepting work when the pinned renderer or its
// OS memory boundary is absent. This probe makes no provider/network call.
config.renderer=await checkRendererRuntime();
const pool=new pg.Pool({connectionString:config.databaseUrl,max:config.poolMax,connectionTimeoutMillis:10000,statement_timeout:20000});
pool.on('error',()=>console.error(JSON.stringify({event:'database-pool',code:'connection-error'})));
const store=new Store(pool,config);await store.init();
const pipeline=new Pipeline(store,new Reader(config,store),config);const stop=pipeline.start();
const server=makeServer(store,pipeline,config);
server.listen(config.port,config.bindHost,()=>console.log(JSON.stringify({event:'document-service-start',version:VERSION,port:config.port})));
let closing=false;async function shutdown(){if(closing)return;closing=true;server.close();const forced=setTimeout(()=>process.exit(1),30000);forced.unref();await stop();await pool.end();clearTimeout(forced);process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
