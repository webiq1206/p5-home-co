import {publicOrigin} from '../../app/lib/public-url.ts';
import {configuredOrigins,protectRequest} from './http.ts';
import {DraftError} from './store.ts';

/** Privileged browser actions require an explicit configured public origin.
 * Request.url may contain the proxy's bind address. Forwarding headers select
 * the public target only after the Origin itself passes the existing allowlist. */
export function protectQaAction(request:Request,message:string){
 const origin=request.headers.get('origin');
 if(!origin||!configuredOrigins().has(origin))throw new DraftError(message,403);
 let target:string;
 try{target=new URL(publicOrigin(request)).origin;}
 catch{throw new DraftError(message,403);}
 if(origin!==target)throw new DraftError(message,403);
 protectRequest(request);
}
