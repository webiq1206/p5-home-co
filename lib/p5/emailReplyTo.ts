/** A single submitted mailbox only: no display names, lists or header controls.
 * Missing/invalid values preserve the adapter's established brand fallback. */
export function safeEmailReplyTo(value:unknown,fallback:string):string {
 if(typeof value!=='string'||value.length>254||/[\x00-\x20\x7f]/.test(value))return fallback;
 const [local,domain,...extra]=value.split('@');
 if(extra.length||!local||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!domain)return fallback;
 if(!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/i.test(local))return fallback;
 const labels=domain.split('.');
 if(labels.length<2||labels.some(label=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))return fallback;
 return value;
}
