import {ServiceError} from './core.mjs';

/** Validate the exact JSON Schema subset used by the provider contracts.
 * Provider-side constrained decoding is not a substitute for local validation.
 * Diagnostics never contain source text or returned model values.
 */
export function validateSchema(value,schema,code='invalid-provider-schema'){
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 const matches=types.some(type=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type);
 if(!matches||schema.enum&&!schema.enum.includes(value))throw new ServiceError(code,422);
 if(value===null)return value;
 if(Array.isArray(value))for(const item of value)validateSchema(item,schema.items,code);
 else if(typeof value==='object'){
  if((schema.required||[]).some(key=>!Object.hasOwn(value,key)))throw new ServiceError(code,422);
  for(const [key,item] of Object.entries(value)){
   if(!Object.hasOwn(schema.properties||{},key)){if(schema.additionalProperties===false)throw new ServiceError(code,422);continue;}
   validateSchema(item,schema.properties[key],code);
  }
 }
 return value;
}
