/** Anthropic's strict grammar does not support length/number constraints.
 * Move those to descriptions; the original local validator still enforces
 * them. Types, required properties, enums and nested records stay intact. */
export function strictExtractionSchema(schema:any):any {
 if(Array.isArray(schema))return schema.map(strictExtractionSchema);
 if(!schema||typeof schema!=='object')return schema;
 const unsupported=new Set(['minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','maxItems']);
 const result:Record<string,unknown>={};
 const constraints:string[]=[];
 for(const [key,value] of Object.entries(schema)){
  if(unsupported.has(key)||(key==='minItems'&&Number(value)>1)){constraints.push(`${key}: ${JSON.stringify(value)}`);continue;}
  result[key]=strictExtractionSchema(value);
 }
 if(constraints.length)result.description=[result.description,`Locally validated constraints: ${constraints.join(', ')}.`].filter(Boolean).join(' ');
 return result;
}
