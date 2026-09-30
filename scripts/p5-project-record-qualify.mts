import {mkdir,writeFile} from 'node:fs/promises';
import {runProjectQualification} from '../lib/p5/projectRecordWork.ts';
import {readDraftById} from '../lib/p5/store.ts';
import {isPricingPending} from '../lib/p5/pricingProgress.ts';

// A qualification entry point for existing controlled QA projects. This never
// sends email, submits a lead or changes the customer's published estimate.
const [id,revisionText,phase]=process.argv.slice(2),revision=Number(revisionText);
if(!/^[a-f0-9-]{36}$/i.test(id||'')||!Number.isSafeInteger(revision)||revision<1||!['interpret','price'].includes(phase))throw new Error('Provide an existing QA draft ID, its current revision and interpret or price.');
const draft=await readDraftById(id);
if(!draft?.contact.name.startsWith('[QA]'))throw new Error('This entry point accepts explicitly marked QA projects only.');
// Actual private permit/transaction documents remain outside this test lane.
if(draft.uploads.length)throw new Error('This first qualification entry point is text-only. Uploaded sources require the separate document qualification lane.');
try{
 const result=await runProjectQualification(id,revision,phase as 'interpret'|'price');
 const directory='/tmp/p5-project-record-qualification';await mkdir(directory,{recursive:true,mode:0o700});
 const file=`${directory}/${id}-${revision}-${phase}.json`;
 await writeFile(file,JSON.stringify(result,null,2),{mode:0o600});
 const value=result as any;
 console.log(JSON.stringify({id,revision,phase,status:value.status,recordRevision:value.record?.revision,requirements:value.record?.requirements?.length,questions:value.record?.questions,problems:value.problems,range:value.customer?.range,receipt:file}));
}catch(error){if(isPricingPending(error))console.log(JSON.stringify({id,revision,phase,pending:true,message:error.message}));else throw error;}
