/** Stable JSON for receipts persisted in PostgreSQL jsonb. Arrays retain their order. */
export function canonicalJson(value:unknown):string {
 const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
 return JSON.stringify(normalize(value));
}
