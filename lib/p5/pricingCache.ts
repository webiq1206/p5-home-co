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
    answerIdentity(scope.answers as unknown as Record<string,unknown>),
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
export const answerEntries=(scope:ReviewedScope)=>answerIdentity(scope.answers as unknown as Record<string,unknown>).map(([k,v])=>[k,v] as [string,string]);
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
  const table=()=>ready||(ready=(async()=>{
    await query(`CREATE TABLE IF NOT EXISTS p5_estimator_price_cache (
      fingerprint text PRIMARY KEY, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz NOT NULL DEFAULT now(),
      uses integer NOT NULL DEFAULT 0)`);
    await query('ALTER TABLE p5_estimator_price_cache ADD COLUMN IF NOT EXISTS document text');
    await query('CREATE INDEX IF NOT EXISTS p5_estimator_price_cache_document ON p5_estimator_price_cache(document,created_at DESC)');
  })());
  const reuse=(fingerprint:string)=>query('UPDATE p5_estimator_price_cache SET used_at=now(),uses=uses+1 WHERE fingerprint=$1',[fingerprint]).catch(()=>undefined);
  const entry=(row:Record<string,any>|undefined)=>row?(typeof row.payload==='string'?JSON.parse(row.payload):row.payload) as PricingCacheEntry:null;
  return {
    async load(keys){
      await table();
      const days=String(pricingCacheDays());
      // The same conversation first; then the same project, whatever it was asked this time.
      const exact=await query(`SELECT payload FROM p5_estimator_price_cache
        WHERE fingerprint=$1 AND created_at>now()-($2||' days')::interval`,[keys.fingerprint,days]);
      if(exact.length){void reuse(keys.fingerprint);return entry(exact[0]);}
      const sameProject=await query(`SELECT fingerprint,payload FROM p5_estimator_price_cache
        WHERE document=$1 AND created_at>now()-($2||' days')::interval ORDER BY created_at DESC LIMIT 1`,[keys.document,days]);
      if(!sameProject.length)return null;
      void reuse(String(sameProject[0].fingerprint));
      return entry(sameProject[0]);
    },
    async save(keys,saved){
      await table();
      await query(`INSERT INTO p5_estimator_price_cache(fingerprint,document,payload) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(fingerprint) DO UPDATE SET payload=EXCLUDED.payload,document=EXCLUDED.document,created_at=now()`,
        [keys.fingerprint,keys.document,JSON.stringify(saved)]);
    },
  };
}
