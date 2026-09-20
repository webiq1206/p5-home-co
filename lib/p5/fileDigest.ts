import {Hash} from 'fast-sha256';
import {SCOPE_CHUNK_SIZE,SCOPE_FILE_LIMIT} from './scope.ts';

// Cache only immutable Blob identities, never names or timestamps. A reselected
// file must be hashed again before trusting a saved transfer manifest.
const digests=new WeakMap<Blob,string>();
export async function fileDigest(file:Blob,signal?:AbortSignal):Promise<string>{
  signal?.throwIfAborted();
  if(!file.size||file.size>SCOPE_FILE_LIMIT)throw new Error('Files must be nonempty and no larger than 250 MiB each.');
  const known=digests.get(file);if(known)return known;
  const hash=new Hash();
  try{
    for(let offset=0;offset<file.size;offset+=SCOPE_CHUNK_SIZE){
      signal?.throwIfAborted();
      hash.update(new Uint8Array(await file.slice(offset,offset+SCOPE_CHUNK_SIZE).arrayBuffer()));
      // Allow cancellation and UI updates between bounded reads and hash work.
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    signal?.throwIfAborted();
    const result=Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
    digests.set(file,result);return result;
  }finally{hash.clean();}
}