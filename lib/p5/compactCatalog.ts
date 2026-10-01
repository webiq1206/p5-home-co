/** Lossless transport encoding: retain every rate, field and value while
 * avoiding repeated keys and shared source text in large catalog prompts. */
export function compactCatalogInput(input:unknown):unknown {
 if(Array.isArray(input))return input.map(compactCatalogInput);
 if(!input||typeof input!=='object')return input;
 return Object.fromEntries(Object.entries(input).map(([key,value])=>{
  if(key!=='catalog'||!Array.isArray(value)||value.length<25)return [key,compactCatalogInput(value)];
  if(value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))return [key,value];
  const columns=Object.keys(value[0]).sort();
  if(value.some(row=>JSON.stringify(Object.keys(row).sort())!==JSON.stringify(columns)))return [key,value];
  const shared:Record<string,unknown>={};
  for(const column of columns)if(value.every(row=>JSON.stringify(row[column])===JSON.stringify(value[0][column])))shared[column]=value[0][column];
  const varying=columns.filter(column=>!Object.hasOwn(shared,column));
  return [key,{encoding:'catalog-columns-v1',shared,columns:varying,rows:value.map(row=>varying.map(column=>row[column]))}];
 }));
}
export const CATALOG_ENCODING_INSTRUCTION='Catalogs marked catalog-columns-v1 retain the full price book. Each rows entry is one rate: pair its values with columns and add all shared fields to reconstruct that rate. Shared fields apply to EVERY row. No rates or qualifications have been omitted. Use the original code and all description, unit, amount, basis and source values when mapping.';
