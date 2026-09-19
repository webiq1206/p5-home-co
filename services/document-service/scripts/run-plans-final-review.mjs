import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runFixture} from './check-sonnet-documents.mjs';

const bundle=JSON.parse(await readFile(resolve(process.argv[2]||'p5-sonnet-fixtures.json'),'utf8'));
const fixture=bundle.fixtures?.find(value=>value.id==='plans');
if(bundle.version!==1||!fixture)throw Error('Expected the private plans fixture.');
const report=await runFixture(fixture,{root:resolve('.p5-model-qa/28ae638a423cc02f'),key:process.env.ANTHROPIC_API_KEY,
 resumePlansReview:true,maxCallsOverride:160});
if(!report.complete)process.exitCode=1;