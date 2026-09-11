/** Copy picker-backed bytes before clearing the input or persisting the selection. */
export async function snapshotProjectFile(file:File):Promise<File> {
  let bytes:ArrayBuffer;
  try{bytes=await file.arrayBuffer();}catch{throw new Error(`${file.name} could not be read from your device. Download it to this device, then select it again.`);}
  if(bytes.byteLength!==file.size)throw new Error(`${file.name} was not fully read. Please select the file again.`);
  return new File([bytes],file.name,{type:file.type,lastModified:file.lastModified});
}
