// One explicit, synthetic provider request. No database, uploads or automatic retries.
import {requestBody,parseReply} from '../src/provider.mjs';
import {REVIEW_SYSTEM,REVIEW_SCHEMA,validateReview} from '../src/contracts.mjs';
import {validateSchema} from '../src/schema.mjs';

try {
 if(process.env.DOCUMENT_PROVIDER!=='anthropic')throw Error('This check is for the configured Anthropic integration.');
 const model=process.env.DOCUMENT_MODEL,key=process.env.ANTHROPIC_API_KEY;
 if(!model||!key)throw Error('DOCUMENT_MODEL or ANTHROPIC_API_KEY is unavailable.');
 const source='P5-QA.pdf';
 const nativeText='Install 120 linear feet of painted baseboard. Install 4 interior doors. Door dimensions are not supplied. Exclude plumbing and electrical work.';
 const manifest=[{source,page:1,sheet:'',revision:'',status:'read',notes:['Door dimensions are not supplied.']}];
 const evidence={page:1,sheet:'',revision:'',status:'read',facts:[
  {field:'trimLf',value:'120 linear feet painted baseboard',evidence:'Install 120 linear feet of painted baseboard.',basis:'stated'},
  {field:'finish',value:'Painted baseboard',evidence:'Install 120 linear feet of painted baseboard.',basis:'stated'},
  {field:'otherDetails',value:'Door dimensions are not supplied',evidence:'Door dimensions are not supplied.',basis:'stated'},
  {field:'exclusions',value:'Plumbing and electrical work excluded',evidence:'Exclude plumbing and electrical work.',basis:'stated'}
 ],items:[
  {id:'baseboard-painted',unit:'lf',basis:'stated',floor:'',building:'',evidence:'Install 120 linear feet of painted baseboard.',quantity:120,component:'Baseboard trim',description:'Painted baseboard installation'},
  {id:'interior-doors',unit:'each',basis:'stated',floor:'',building:'',evidence:'Install 4 interior doors. Door dimensions are not supplied.',quantity:4,component:'Interior door',description:'Interior doors, dimensions not supplied'}
 ],notes:['Door dimensions are not supplied.'],regions:[],exclusions:['Exclude plumbing and electrical work.'],inclusions:['Install 120 linear feet of painted baseboard.','Install 4 interior doors.'],responsibilities:[]};
 const input={text:'P5 QA synthetic test. Estimate only the work included in the uploaded scope. Preserve its exclusions.',answers:{},documents:[{source,pages:[{page:1,evidence,nativeText}]}]};
 const built=requestBody('anthropic',model,REVIEW_SYSTEM,input,[],REVIEW_SCHEMA,4096,'review');
 if(built.body.output_config||!built.outputTool)throw Error('The reconciliation tool-output patch is missing.');
 console.log('Model:',model);
 console.log('Making one synthetic reconciliation request. No PDF is uploaded or read.');
 const started=performance.now();
 const response=await fetch(built.url,{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify(built.body),signal:AbortSignal.timeout(45000),redirect:'error'});
 const data=await response.json();
 console.log('HTTP status:',response.status);
 if(!response.ok){
  // Only synthetic public input was sent. Never reuse this diagnostic for customer data.
  console.log('Provider error:',JSON.stringify(data.error||{type:'unknown-error'}));
  throw Error('Provider rejected the synthetic request.');
 }
 const result=validateReview(validateSchema(parseReply('anthropic',data,built.outputTool),REVIEW_SCHEMA),manifest);
 console.log('PASS: Provider response passed structural and source-reference validation.');
 console.log('Provider wait (ms):',Math.round(performance.now()-started));
 console.log(JSON.stringify(result,null,2));
 console.log('This does not verify deployment, pricing, email or document performance.');
} catch(error) {
 console.error('Check stopped:',error.code||(['TimeoutError','AbortError'].includes(error.name)?'provider-timeout':error.message));
 process.exitCode=1;
}
