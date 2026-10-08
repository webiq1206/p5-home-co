/** One PGlite runtime per test process. Creating a fresh WebAssembly instance for every
 * test let V8 abort while unregistering freed Wasm code pages on Node 24 (a fatal
 * "jit_page_->allocations_.erase(addr) == 1" check during teardown). A single runtime
 * with a fresh public schema per test keeps the same isolation without that teardown. */
import {PGlite} from '@electric-sql/pglite';
let runtime:PGlite|null=null;
export type IsolatedDatabase={query:PGlite['query'];exec:PGlite['exec'];close:()=>Promise<void>};
export async function isolatedDatabase():Promise<IsolatedDatabase>{
 if(!runtime){runtime=new PGlite();await runtime.waitReady;}
 const db=runtime;
 await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
 // The shared runtime lives for the whole process; a test's close is a no-op.
 return {query:db.query.bind(db),exec:db.exec.bind(db),close:async()=>{}};
}
