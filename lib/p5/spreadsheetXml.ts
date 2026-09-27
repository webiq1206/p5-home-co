import JSZip from 'jszip';
import {SaxesParser} from 'saxes';

const SHEET_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_NS=new Set(['http://schemas.openxmlformats.org/package/2006/relationships','http://schemas.openxmlformats.org/package/2006/content-types']);
const escapeText=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escapeAttribute=(value:string)=>escapeText(value).replace(/"/g,'&quot;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;').replace(/\t/g,'&#9;');
/** ExcelJS matches literal tag names. Canonicalize equivalent namespace prefixes,
 * using an XML parser so cell text, formula strings and namespace scope survive. */
function canonicalXml(xml:string){
 const parser=new SaxesParser({xmlns:true});const defaults:string[]=[];const parts=['<?xml version="1.0" encoding="UTF-8"?>'];
 const name=(tag:{uri:string;local:string;name:string})=>tag.uri===SHEET_NS||PACKAGE_NS.has(tag.uri)?tag.local:tag.name;
 parser.on('doctype',()=>{throw new Error('Spreadsheet XML must not contain a document type.');});
 parser.on('opentag',tag=>{
  const attrs=Object.values(tag.attributes).map(a=>`${a.uri===REL_NS?`r:${a.local}`:a.name}="${escapeAttribute(a.value)}"`);
  let defaultNamespace=tag.attributes.xmlns?.value??defaults.at(-1)??'';
  if(tag.uri===SHEET_NS||PACKAGE_NS.has(tag.uri)){
   const defaultIndex=attrs.findIndex(a=>a.startsWith('xmlns="'));if(defaultIndex>=0)attrs.splice(defaultIndex,1);
   if(defaults.at(-1)!==tag.uri)attrs.push(`xmlns="${tag.uri}"`);
   defaultNamespace=tag.uri;
  }
  if(Object.values(tag.attributes).some(a=>a.uri===REL_NS)&&!attrs.some(a=>a.startsWith('xmlns:r="')))attrs.push(`xmlns:r="${REL_NS}"`);
  defaults.push(defaultNamespace);
  parts.push(`<${name(tag)}${attrs.length?' '+attrs.join(' '):''}>`);
 });
 parser.on('closetag',tag=>{parts.push(`</${name(tag)}>`);defaults.pop();});
 parser.on('text',value=>parts.push(escapeText(value)));
 parser.on('cdata',value=>parts.push(escapeText(value)));
 parser.write(xml).close();return parts.join('');
}
/** Caller must verify archive size/expansion before loading its members. */
export async function canonicalSpreadsheetArchive(data:Buffer){
 const zip=await JSZip.loadAsync(data);let changed=false;
 for(const [path,entry] of Object.entries(zip.files)){
  if(entry.dir||!(/^(?:xl\/.*\.xml|(?:xl\/)?_rels\/.*\.rels|\[Content_Types\]\.xml)$/.test(path)))continue;
  const xml=await entry.async('string');
  // Default-namespace workbooks already parse directly; avoid rewriting them.
  if(!/<\/?[\w.-]+:/.test(xml))continue;
  zip.file(path,canonicalXml(xml));changed=true;
 }
 return changed?zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}):data;
}
