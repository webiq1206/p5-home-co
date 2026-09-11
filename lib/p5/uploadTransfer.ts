/** Upload separately from model analysis so a confirmed file survives analysis failures. */
export function transferProjectFiles(form:FormData,headers:Record<string,string>,progress:(percent:number)=>void):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();request.open('POST','/api/p5-estimator/scope');request.timeout=120000;
    for(const [key,value]of Object.entries(headers))request.setRequestHeader(key,value);
    request.upload.onprogress=event=>{if(event.lengthComputable)progress(Math.min(99,Math.round(event.loaded/event.total*100)));};
    request.onerror=()=>reject(new Error('The upload connection was interrupted. Your files are still in this tab. Please retry.'));
    request.ontimeout=()=>reject(new Error('The upload took too long. Keep this tab open and retry on a stable connection.'));
    request.onabort=()=>reject(new Error('Upload interrupted. Your files are still in this tab.'));
    request.onload=()=>{try{const data=JSON.parse(request.responseText);if(request.status<200||request.status>=300)throw new Error(data.error||'The upload could not be confirmed. Please retry.');resolve(data);}catch(error){reject(error instanceof Error?error:new Error('The upload response could not be read. Please retry.'));}};
    request.send(form);
  });
}
