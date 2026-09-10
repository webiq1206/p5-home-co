import ExcelJS from "exceljs";
import mammoth from "mammoth";
import type { AnalysisFile } from "./extraction.ts";
import { SCOPE_FILE_LIMIT } from "./scope.ts";
const TYPES: Record<string,string> = {
  pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",
  txt:"text/plain",csv:"text/csv",json:"application/json",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",ods:"application/vnd.oasis.opendocument.spreadsheet",
  doc:"application/msword",heic:"image/heic",heif:"image/heif",
};
export const ACCEPT_SCOPE_FILES = Object.keys(TYPES).map(ext=>`.${ext}`).join(",");
export function verifyUpload(name: string, data: Buffer): AnalysisFile {
  if (!data.length || data.length > SCOPE_FILE_LIMIT) throw new Error("Files must be nonempty and no larger than 10 MB each.");
  const safeName=name.replace(/[\u0000-\u001f/\\]/g,"_").slice(0,180);
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
/** Reject oversized/encrypted archives before invoking an office parser. No extraction to disk. */
export function checkOfficeArchive(data:Buffer) {
  let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error("This office document is damaged or unsupported.");
  const count=data.readUInt16LE(end+10);const centralSize=data.readUInt32LE(end+12);let offset=data.readUInt32LE(end+16);
  if(!count||count>3000||offset+centralSize>end)throw new Error("This office document is too complex to analyze automatically.");
  let total=0;
  for(let i=0;i<count;i++){
    if(offset+46>data.length||data.readUInt32LE(offset)!==0x02014b50)throw new Error("Damaged office document.");
    const flags=data.readUInt16LE(offset+8);const compressed=data.readUInt32LE(offset+20);const expanded=data.readUInt32LE(offset+24);
    const local=data.readUInt32LE(offset+42);
    if(flags&1||expanded===0xffffffff||compressed===0xffffffff||expanded>16*1024*1024||local+30>data.length||data.readUInt32LE(local)!==0x04034b50)throw new Error("Encrypted or oversized office documents need manual review.");
    total+=expanded;if(total>32*1024*1024)throw new Error("This document expands beyond the automatic review limit.");
    offset+=46+data.readUInt16LE(offset+28)+data.readUInt16LE(offset+30)+data.readUInt16LE(offset+32);
  }
}
export async function prepareAnalysisFiles(files:AnalysisFile[]) {
  const readable:AnalysisFile[]=[];const manualReview:string[]=[];
  for(const file of files){
    if(file.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"){
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(file.data as any);
      const parts:string[]=[];let cells=0;
      workbook.eachSheet(sheet=>{parts.push(`Worksheet: ${sheet.name}`);sheet.eachRow((row,rowNumber)=>{
        const values:string[]=[];row.eachCell((cell,column)=>{if(++cells>20000)throw new Error("Spreadsheet exceeds 20,000 populated cells. Upload the relevant sheets.");values.push(`${column}: ${cell.text}${cell.formula ? ` [formula: ${cell.formula}; cached result: ${String(cell.result ?? "not supplied")}]` : ""}`);});
        parts.push(`Row ${rowNumber}: ${values.join(" | ")}`);
      });});
      const text=parts.join("\n");if(text.length>120000)throw new Error("Spreadsheet text is too large. Upload the relevant scope sheets.");
      readable.push({...file,type:"text/plain",data:Buffer.from(text)});
    }else if(file.type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
      const result=await mammoth.extractRawText({buffer:file.data});
      if(result.value.length>120000)throw new Error("Document text is too large. Upload the relevant scope pages.");
      readable.push({...file,type:"text/plain",data:Buffer.from(result.value)});
    }else if(["application/msword","application/vnd.ms-excel","application/vnd.oasis.opendocument.spreadsheet","image/heic","image/heif"].includes(file.type))manualReview.push(`${file.name}: saved for manual review. Export as PDF, XLSX, DOCX, JPEG or PNG for automatic extraction.`);
    else readable.push(file);
  }
  return {readable,manualReview};
}
