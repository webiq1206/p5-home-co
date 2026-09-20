import {prepareImages} from "./imagePreparation.ts";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import {inflateRawSync} from "node:zlib";
import {openablePdf} from "./pdfAccess.ts";
import type { AnalysisFile } from "./extraction.ts";
import { SCOPE_FILE_LIMIT,SCOPE_MAX_PAGES } from "./scope.ts";
const TYPES: Record<string,string> = {
  pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",
  txt:"text/plain",csv:"text/csv",json:"application/json",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",ods:"application/vnd.oasis.opendocument.spreadsheet",
  doc:"application/msword",heic:"image/heic",heif:"image/heif",tif:"image/tiff",tiff:"image/tiff",avif:"image/avif",
};
export const ACCEPT_SCOPE_FILES = Object.keys(TYPES).map(ext=>`.${ext}`).join(",");
export const DOCUMENT_TEXT_LIMIT=2*1024*1024;
export const OFFICE_INPUT_LIMIT=16*1024*1024;
export const uploadDisplayName=(name:string)=>name.replace(/[\u0000-\u001f/\\]/g,"_").slice(0,180)||"Uploaded file";
export const emptyUploadMessage=(name:string)=>`${uploadDisplayName(name)} is empty.`;
export function verifyUpload(name: string, data: Buffer): AnalysisFile {
  if (!data.length) throw new Error(emptyUploadMessage(name));
  if (data.length > SCOPE_FILE_LIMIT) throw new Error("Files must be no larger than 250 MiB each.");
  const safeName=uploadDisplayName(name);
  const extension=safeName.split(".").pop()?.toLowerCase()||"";const type=TYPES[extension];
  if(!type)throw new Error("Use a PDF, photo, Word document, spreadsheet or text file.");
  if(extension==="pdf" && !data.subarray(0,1024).includes(Buffer.from("%PDF-")))throw new Error("This file is not a readable PDF.");
  if(extension==="png" && !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error("This file is not a valid PNG.");
  if(["jpg","jpeg"].includes(extension) && !(data[0]===255&&data[1]===216&&data[2]===255))throw new Error("This file is not a valid JPEG.");
  if(extension==="webp" && !(data.subarray(0,4).toString()==="RIFF"&&data.subarray(8,12).toString()==="WEBP"))throw new Error("This file is not a valid WebP.");
  if(extension==="gif" && !/^GIF8[79]a$/.test(data.subarray(0,6).toString()))throw new Error("This file is not a valid GIF.");
  if(["docx","xlsx","ods"].includes(extension))checkOfficeArchive(data);
  return {name:safeName,type,data};
}
/** Enforce the customer-facing PDF boundary before any provider work begins. */
export async function verifyPdfPageLimit(name:string,data:Buffer){
  // A permission-restricted PDF that opens without a password is accepted;
  // only a real password or a damaged file is refused, each with its own message.
  const pages=(await openablePdf(name,data)).pages;
  if(!pages)throw new Error(`${name}: PDF must contain at least one page.`);
  if(pages>SCOPE_MAX_PAGES)throw new Error(`${name}: plans may contain at most ${SCOPE_MAX_PAGES} pages.`);
  return pages;
}
/** Reject oversized/encrypted archives before invoking an office parser. No extraction to disk. */
export function checkOfficeArchive(data:Buffer) {
  let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50&&i+22+data.readUInt16LE(i+20)===data.length){end=i;break;}
  if(end<0)throw new Error("This office document is damaged or unsupported.");
  const count=data.readUInt16LE(end+10);const centralSize=data.readUInt32LE(end+12);let offset=data.readUInt32LE(end+16);
  const centralStart=offset;
  if(data.readUInt16LE(end+4)||data.readUInt16LE(end+6)||data.readUInt16LE(end+8)!==count||!count||count>3000||offset+centralSize!==end)throw new Error("This office document is too complex to analyze automatically.");
  let total=0;
  for(let i=0;i<count;i++){
    if(offset+46>end||data.readUInt32LE(offset)!==0x02014b50)throw new Error("Damaged office document.");
    const flags=data.readUInt16LE(offset+8);const compressed=data.readUInt32LE(offset+20);const expanded=data.readUInt32LE(offset+24);
    const local=data.readUInt32LE(offset+42);
    if(flags&1||expanded===0xffffffff||compressed===0xffffffff||expanded>16*1024*1024||local+30>centralStart||data.readUInt32LE(local)!==0x04034b50)throw new Error("Encrypted or oversized office documents need manual review.");
    const method=data.readUInt16LE(offset+10),start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
    if(data.readUInt16LE(local+6)&1||data.readUInt16LE(local+8)!==method||start+compressed>centralStart||![0,8].includes(method))throw new Error("Damaged or unsupported office document.");
    // ZIP metadata can lie about expansion. Bound the actual inflater output
    // before ExcelJS/Mammoth get a chance to allocate from untrusted XML.
    const content=data.subarray(start,start+compressed);
    const actual=method===0?content:inflateRawSync(content,{maxOutputLength:Math.max(1,expanded)});
    if(actual.length!==expanded)throw new Error("Office archive expansion does not match its declared size.");
    total+=expanded;if(total>32*1024*1024)throw new Error("This document expands beyond the automatic review limit.");
    offset+=46+data.readUInt16LE(offset+28)+data.readUInt16LE(offset+30)+data.readUInt16LE(offset+32);
  }
  if(offset!==end)throw new Error("Damaged office document.");
}
/** Validate saved ZIP metadata through bounded reads, without buffering a large upload. */
export async function checkOfficeArchiveRanges(size:number,read:(offset:number,length:number)=>Promise<Buffer>) {
  const invalid=()=>new Error('This office document is damaged or unsupported.');
  if(size<22)throw invalid();
  const tailStart=Math.max(0,size-65557),tail=await read(tailStart,size-tailStart);
  let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0)throw invalid();
  const count=tail.readUInt16LE(end+10),centralSize=tail.readUInt32LE(end+12),centralStart=tail.readUInt32LE(end+16),centralEnd=centralStart+centralSize;
  if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||tail.readUInt16LE(end+8)!==count||!count||count>3000||centralEnd!==tailStart+end)throw invalid();
  let offset=centralStart,total=0;
  for(let i=0;i<count;i++){
    if(offset+46>centralEnd)throw invalid();
    const entry=await read(offset,46);
    if(entry.readUInt32LE(0)!==0x02014b50)throw invalid();
    const flags=entry.readUInt16LE(8),compressed=entry.readUInt32LE(20),expanded=entry.readUInt32LE(24),local=entry.readUInt32LE(42);
    const next=offset+46+entry.readUInt16LE(28)+entry.readUInt16LE(30)+entry.readUInt16LE(32);
    if(flags&1||expanded===0xffffffff||compressed===0xffffffff||expanded>16*1024*1024||next>centralEnd||local+30>centralStart)throw invalid();
    const header=await read(local,30);
    if(header.readUInt32LE(0)!==0x04034b50||header.readUInt16LE(6)&1||local+30+header.readUInt16LE(26)+header.readUInt16LE(28)+compressed>centralStart)throw invalid();
    total+=expanded;if(total>32*1024*1024)throw new Error('This document expands beyond the automatic review limit.');
    offset=next;
  }
  if(offset!==centralEnd)throw invalid();
}
export async function prepareAnalysisFiles(files:AnalysisFile[]) {
  const readable:AnalysisFile[]=[];const manualReview:string[]=[];
  for(const file of files){
    try{
    if(file.type==="application/pdf"){
      const pageCount=(await openablePdf(file.name,file.data)).pages;
      if(!pageCount||pageCount>SCOPE_MAX_PAGES)throw new Error(`Use PDFs with 1 to ${SCOPE_MAX_PAGES} pages.`);
      readable.push(file);
    }else if(["image/heic","image/heif","image/tiff","image/avif"].includes(file.type)||(file.type.startsWith("image/")&&file.data.length>16*1024*1024)){readable.push(...await prepareImages(file));
    }else if(file.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"){
      if(file.data.length>OFFICE_INPUT_LIMIT)throw new Error("Automatic spreadsheet conversion is limited to 16 MiB. Export the relevant sheets as CSV or PDF.");
      checkOfficeArchive(file.data);
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(file.data as any);
      const parts:string[]=[];let cells=0,bytes=0;
      const append=(text:string)=>{bytes+=Buffer.byteLength(text)+1;if(bytes>DOCUMENT_TEXT_LIMIT)throw new Error("Spreadsheet text exceeds 2 MiB. Upload the relevant sheets.");parts.push(text);};
      workbook.eachSheet(sheet=>{append(`Worksheet: ${sheet.name}`);sheet.eachRow((row,rowNumber)=>{
        const values:string[]=[];row.eachCell((cell,column)=>{if(++cells>20000)throw new Error("Spreadsheet exceeds 20,000 populated cells. Upload the relevant sheets.");values.push(`${column}: ${cell.text}${cell.formula ? ` [formula: ${cell.formula}; cached result: ${String(cell.result ?? "not supplied")}]` : ""}`);});
        append(`Row ${rowNumber}: ${values.join(" | ")}`);
      });});
      const text=parts.join("\n");
      readable.push({...file,type:"text/plain",data:Buffer.from(text)});
    }else if(file.type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
      if(file.data.length>OFFICE_INPUT_LIMIT)throw new Error("Automatic Word conversion is limited to 16 MiB. Export the relevant pages as PDF.");
      checkOfficeArchive(file.data);
      const result=await mammoth.extractRawText({buffer:file.data});
      if(Buffer.byteLength(result.value)>DOCUMENT_TEXT_LIMIT)throw new Error("Document text exceeds 2 MiB. Upload the relevant sections.");
      readable.push({...file,type:"text/plain",data:Buffer.from(result.value)});
    }else if(["application/msword","application/vnd.ms-excel","application/vnd.oasis.opendocument.spreadsheet"].includes(file.type))manualReview.push(`${file.name}: saved for manual review. Export as PDF, XLSX, DOCX, JPEG or PNG for automatic extraction.`);
    else{
      if(["text/plain","text/csv","application/json"].includes(file.type)&&file.data.length>DOCUMENT_TEXT_LIMIT)throw new Error("Automatic text and CSV reading is limited to 2 MiB. Upload the relevant rows or sections.");
      readable.push(file);
    }
    }catch(error){manualReview.push(`${file.name}: could not read this file automatically. ${error instanceof Error?error.message:"Export a fresh PDF copy."}`);}
  }
  return {readable,manualReview};
}
