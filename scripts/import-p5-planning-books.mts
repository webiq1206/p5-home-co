import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPlanningConfiguration,validatePlanningCatalog,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

// Run against a private input file. Source rates must never be checked into Git.
const inputPath=process.argv[2];if(!inputPath)throw new Error('Supply the private planning catalog JSON path. Add --apply to store it.');
const catalog=validatePlanningCatalog(JSON.parse(await readFile(inputPath,'utf8')) as PlanningCatalog);
const prepared=createPlanningConfiguration(catalog,ESTIMATOR_BRAND.services);
const exampleAnswers={location:'Boise',sqft:'180',flooringSqft:'180',tileSqft:'40',cabinetBaseLf:'20',cabinetUpperLf:'15',cabinetTallLf:'0',cabinetRoom:'kitchen',taskList:'Replace one toilet and paint 180 square feet of walls',laborHours:'8',finish:'mid-range',garageIncluded:'no',stories:'1'};
for(const service of ESTIMATOR_BRAND.services){
 const answers={...exampleAnswers,service,taskList:['new-construction','adu','addition','kitchen','bathroom','whole-home'].includes(service)?'Complete project renovation and construction':exampleAnswers.taskList,sqft:['new-construction','adu','addition'].includes(service)?'1600':exampleAnswers.sqft};
 const reviewed={text:answers.taskList,answers,extraction:null,uploads:[],reviewedAt:catalog.importedAt,corrections:[]};
 const result=priceReviewedScope(reviewed,prepared);
 if(result.customer.status!=='planning-range'||!result.customer.range)throw new Error(`Catalog validation failed for ${service}. Inspect missing rate and quantity warnings before importing.`);
}
if(!process.argv.includes('--apply')){console.log(JSON.stringify({valid:true,brand:ESTIMATOR_BRAND.id,catalogRates:catalog.rates.length,services:prepared.costBooks.map(b=>b.service),stored:false}));process.exit(0);}
const {query}=await import('../lib/p5/database.ts');const {ensureSchema}=await import('../lib/p5/store.ts');await ensureSchema();
await query('CREATE TABLE IF NOT EXISTS p5_estimator_policy_imports (id text PRIMARY KEY, prior_payload jsonb, imported_payload jsonb NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
const [prior]=await query("SELECT payload,version FROM p5_estimator_policy WHERE id='current'");
const configuration={...prepared,finance:prior?.payload?.finance||prepared.finance,costBooks:prepared.costBooks.map(book=>prior?.payload?.costBooks?.find((old:any)=>old.service===book.service&&old.mode!=='owner-planning')||book)};
const id=createHash('sha256').update(JSON.stringify({brand:ESTIMATOR_BRAND.id,configuration})).digest('hex');
if(JSON.stringify(prior?.payload)===JSON.stringify(configuration)){console.log(JSON.stringify({stored:true,unchanged:true,version:prior.version,catalogRates:catalog.rates.length,services:configuration.costBooks.map(b=>b.service)}));process.exit(0);}
// One SQL statement provides compare-and-swap plus an immutable recovery snapshot.
const result=await query(`WITH saved AS (
 INSERT INTO p5_estimator_policy(id,payload,updated_by) SELECT 'current',$1::jsonb,$2 WHERE $3=0
 ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_by=EXCLUDED.updated_by,updated_at=now(),version=p5_estimator_policy.version+1 WHERE p5_estimator_policy.version=$3
 RETURNING version
), existing_update AS (
 UPDATE p5_estimator_policy SET payload=$1::jsonb,updated_by=$2,updated_at=now(),version=version+1 WHERE id='current' AND version=$3 AND $3>0 RETURNING version
), recorded AS (
 INSERT INTO p5_estimator_policy_imports(id,prior_payload,imported_payload,actor) SELECT $4,$5::jsonb,$1::jsonb,$2 WHERE EXISTS(SELECT 1 FROM saved UNION ALL SELECT 1 FROM existing_update) ON CONFLICT(id) DO NOTHING
) SELECT version FROM saved UNION ALL SELECT version FROM existing_update`,[JSON.stringify(configuration),catalog.authorizedBy,prior?.version||0,id,JSON.stringify(prior?.payload||null)]);
if(!result.length)throw new Error('Pricing configuration changed during import. Reload and retry.');
const [confirmed]=await query("SELECT payload,version FROM p5_estimator_policy WHERE id='current'");
if(confirmed?.payload?.planningCatalog?.version!==catalog.version)throw new Error('The saved catalog did not survive a fresh read.');
console.log(JSON.stringify({stored:true,brand:ESTIMATOR_BRAND.id,version:confirmed.version,catalogRates:confirmed.payload.planningCatalog.rates.length,services:confirmed.payload.costBooks.map((b:any)=>b.service),recoverySnapshot:id}));
