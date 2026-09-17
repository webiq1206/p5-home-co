import fs from 'node:fs';
const file='lib/p5/analysisWork.ts';let s=fs.readFileSync(file,'utf8');
if(!s.includes("from './documentServiceClient.ts'")){
 s="import {documentServiceEligible,advanceDocumentService} from './documentServiceClient.ts';\n"+s;
 const marker='  remainingBudget(absoluteDeadline);';
 if(!s.includes(marker))throw Error('Analysis integration point changed; inspect before applying.');
 s=s.replace(marker,marker+"\n  if(documentServiceEligible(draft.uploads))return advanceDocumentService(draft,text,answers,analysisWorkKey(draft,text,answers),request,retryFailed,absoluteDeadline);");
 s=s.replace('`analysis:v8:${','`analysis:${process.env.P5_DOCUMENT_SERVICE_MODE===\'remote\'?\'document-service-v1\':\'v8\'}:${');
 fs.writeFileSync(file,s);
}
const bg='lib/p5/backgroundJobs.ts';let b=fs.readFileSync(bg,'utf8');
if(!b.includes('documentServiceProtocol:')){
 const pattern=/\{engineVersion:(\d+),kind:input\.kind,id:input\.draft\.id,text:input\.text/;
 if(!pattern.test(b))throw Error('Background analysis key changed; inspect before applying.');
 b=b.replace(pattern,"{engineVersion:$1,...(process.env.P5_DOCUMENT_SERVICE_MODE==='remote'?{documentServiceProtocol:'v1',documentServiceOrigin:process.env.P5_DOCUMENT_SERVICE_URL}:{}),kind:input.kind,id:input.draft.id,text:input.text");
 fs.writeFileSync(bg,b);
}
console.log('Shared document-service adapter integrated. Remote mode remains off until explicitly configured.');
