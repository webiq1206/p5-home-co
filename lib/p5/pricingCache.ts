import {createHash} from 'node:crypto';
import {ESTIMATOR_BRAND} from './brand.ts';
import {ESTIMATOR_VERSION} from './version.ts';
import type {ReviewedScope} from './scope.ts';
import type {EstimatorConfiguration, ScopePriceResolution} from './costBook.ts';

/**
 * The same document, answered the same way, must produce the same price.
 *
 * Reading and mapping are model stages, so two runs of one RE-10 inventory
 * slightly different tasks and model slightly different quantities. A visitor
 * who uploads their document twice then sees two different numbers, which
 * reads as guesswork however well each number is justified.
 *
 * So a finished estimate is saved against a fingerprint of what the CUSTOMER
 * supplied - the document bytes, their typed scope, their answers - together
 * with what the OWNER priced it against (the catalog and the finance policy).
 * A later submission with the same fingerprint replays the saved pricing
 * instead of asking the provider again. Change the document, an answer, a rate
 * or a margin and the fingerprint changes, so a stale price can never be
 * served for different work.
 *
 * What is stored is the pricing RESOLUTION - rules, quantities, assumptions,
 * findings - and the audit trail, never a rendered customer estimate. The
 * projection is rebuilt from the draft being priced, so nothing another
 * visitor typed can travel into this one's estimate.
 */
export interface PricingCacheEntry { resolution:ScopePriceResolution; auditTrail:unknown; answers?:[string,string][] }
export interface PricingCacheKeys { fingerprint:string; document:string }
export interface PricingCache {
  load(keys:PricingCacheKeys):Promise<PricingCacheEntry|null>;
  save(keys:PricingCacheKeys,entry:PricingCacheEntry):Promise<void>;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const words=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim().toLowerCase();
/** Answers in a stable order, with blank values dropped so an empty field and a missing one agree. */
const answerIdentity=(answers:Record<string,unknown>)=>Object.keys(answers).sort()
  .map(key=>[key,words(answers[key])] as const).filter(([,value])=>value.length>0);
/** What the owner is pricing against: every rate, its unit and its amount, plus the margin policy. */
export const configurationIdentity=(configuration:EstimatorConfiguration)=>digest([
  configuration.planningCatalog?.version||null,
  (configuration.planningCatalog?.rates||[]).map(rate=>[rate.code,rate.unit,rate.amount,rate.type]).sort(),
  configuration.finance,
  (configuration.costBooks||[]).map(book=>[book.service,book.mode||null,(book.rules||[]).length]).sort(),
]);
/**
 * The identity of a priced job. Deliberately built from customer input only:
 * the extraction is a model reading of that input and differs run to run, so
 * including it would defeat the whole purpose.
 */
export function pricingScopeFingerprint(scope:ReviewedScope,configuration:EstimatorConfiguration):string{
  return digest([
    'p5-price-v1',ESTIMATOR_VERSION,ESTIMATOR_BRAND.id,
    words(scope.text),
    answerEntries(scope),
    (scope.uploads||[]).filter(upload=>upload.status==='stored').map(upload=>upload.sha256).filter(Boolean).sort(),
    (scope.corrections||[]).map(correction=>[correction.field,words(correction.value)]).sort(),
    configurationIdentity(configuration),
  ]);
}
/**
 * The identity of the PROJECT rather than of one conversation about it.
 *
 * Which clarifications the reader asks varies from one run to the next, so the answers vary, so
 * the exact identity above varies - and a visitor re-uploading one document saw a second price
 * purely because they were asked different questions. This key covers what the customer actually
 * brought: their documents, their typed scope, and the service. A saved price found under it is
 * replayed only when nothing the customer stated this time contradicts what was priced before.
 */
export function documentScopeFingerprint(scope:ReviewedScope,configuration:EstimatorConfiguration):string{
  return digest([
    'p5-price-doc-v1',ESTIMATOR_VERSION,ESTIMATOR_BRAND.id,
    words(scope.answers?.service),
    words(scope.text),
    (scope.uploads||[]).filter(upload=>upload.status==='stored').map(upload=>upload.sha256).filter(Boolean).sort(),
    configurationIdentity(configuration),
  ]);
}
/**
 * The answer fields a saved price is compared on: measurements, counts and chosen options, plus
 * the location and the scope limits a customer states in their own words.
 *
 * Deliberately NOT every field. The reader writes its own summary of the uploaded document into
 * the narrative fields - taskList, electrical, plumbing, otherDetails and the rest - and it
 * summarises differently each time it reads. Two runs of one RE-10 produced "install vacuum
 * breakers on all exterior hose bibs" and "install vacuum breakers on exterior hose bibs", which
 * is the same work described twice. Comparing that prose compares the reader against itself and
 * never matches, which is exactly the drift a saved price exists to remove. What a customer
 * actually decides - how many square feet, which finish, what to leave out - is structured, and
 * that is what must agree.
 */
const COMPARED_FIELDS=new Set([
  'service','finish','garageIncluded','cabinetRoom','urgency','complexity','location','address',
  'exclusions','ownerSupplied','alternates','allowances','permits',
  'sqft','garageSqft','coveredOutdoorSqft','cabinetTallLf','length','width','rooms','bathrooms','stories',
  'cabinetBaseLf','cabinetUpperLf','flooringSqft','tileSqft','countertopSqft','demolitionSqft',
  'fixtureCount','laborHours','trimLf','projectMonths',
]);
export const answerEntries=(scope:ReviewedScope)=>answerIdentity(scope.answers as unknown as Record<string,unknown>)
  .filter(([field])=>COMPARED_FIELDS.has(field)).map(([k,v])=>[k,v] as [string,string]);
/**
 * Whether a saved price still describes what this visitor is asking for. Every field they have
 * stated in both runs must agree. A field only one run holds is a question the other was never
 * asked, which is exactly the drift this key exists to absorb; a field they answered differently
 * is a different project, and it prices again.
 */
export function compatibleAnswers(saved:[string,string][]|undefined,current:[string,string][]):boolean{
  if(!saved)return false;
  const before=new Map(saved);
  return current.every(([field,value])=>!before.has(field)||before.get(field)===value);
}
/** How long a saved price may be replayed. A rate carries its own validity; this stays inside it. */
export const pricingCacheDays=()=>{
  const configured=Number(process.env.P5_PRICING_CACHE_DAYS||'');
  return Number.isFinite(configured)&&configured>0?configured:30;
};
export const pricingCacheEnabled=()=>process.env.P5_PRICING_CACHE!=='off';
/**
 * A saved price is replayed only when it is a real estimate: priced lines and
 * no unresolved finding. A hand-off is never cached, so a scope that could not
 * be priced is tried again rather than refusing forever.
 */
export function reusableResolution(resolution:ScopePriceResolution|undefined|null):boolean{
  if(!resolution||!Array.isArray(resolution.rules)||!Array.isArray(resolution.issues))return false;
  if(resolution.issues.length)return false;
  return resolution.rules.some(rule=>rule.unitCost>0&&(rule.quantity?.fixed??0)>0);
}
/** The saved-price store this brand's database provides. Loaded lazily so pure pricing imports
 * never open the site's database driver, the same way the charge ledger does it. */
export function databasePricingCache():PricingCache{
  const query=async(statement:string,values:unknown[]=[])=>(await import('./database.ts')).query(statement,values);
  // Created on first use, the way the charge ledger creates its own tables: a table declared in
  // the shared schema but absent from a brand's database turns a publish into a schema migration.
  let ready:Promise<unknown>|null=null;
  // Saved prices live as rows in the estimator's existing key-value table, under their own id
  // prefix. A table of their own would be a production schema change, and a schema change turns
  // every publish into a database review; this needs no migration on any brand. Every reader of
  // that table selects the single 'current' policy row, so these rows are invisible to them.
  const id=(fingerprint:string)=>`price-cache:${fingerprint}`;
  const entry=(row:Record<string,any>|undefined)=>{
    if(!row)return null;
    const payload=(typeof row.payload==='string'?JSON.parse(row.payload):row.payload) as PricingCacheEntry&{document?:string};
    return payload&&payload.resolution?payload:null;
  };
  const fresh=`updated_at>now()-($2||' days')::interval`;
  return {
    async load(keys){
      const days=String(pricingCacheDays());
      // The same conversation first; then the same project, whatever it was asked this time.
      const exact=await query(`SELECT payload FROM p5_estimator_policy WHERE id=$1 AND ${fresh}`,[id(keys.fingerprint),days]);
      if(exact.length)return entry(exact[0]);
      const sameProject=await query(`SELECT payload FROM p5_estimator_policy
        WHERE id LIKE 'price-cache:%' AND payload->>'document'=$1 AND ${fresh}
        ORDER BY updated_at DESC LIMIT 1`,[keys.document,days]);
      return entry(sameProject[0]);
    },
    async save(keys,saved){
      await query(`INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES($1,$2::jsonb,'price-cache')
        ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,
        [id(keys.fingerprint),JSON.stringify({...saved,document:keys.document})]);
    },
  };
}
