// Merge the Boise rate card into this brand's saved estimator policy.
//
// Run it inside a Replit workspace shell, where DATABASE_URL points at that
// brand's database:  node scripts/p5-load-rate-card.mjs [--apply]
//
// Without --apply it prints what would change and writes nothing. It is
// additive: an existing code keeps the amount already saved unless --replace
// is given, and no rate is ever deleted. The previous payload is written to
// p5-policy-backup-<timestamp>.json in the working directory first.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
const apply=args.includes('--apply'),replace=args.includes('--replace');
const file=args.find(a=>a.endsWith('.json'))||path.join('scripts','p5-boise-rate-card.json');
const url=process.env.DATABASE_URL||process.env.PGDATABASE_URL;
if(!url){console.error('DATABASE_URL is not set; run this inside the workspace shell.');process.exit(1);}

const card=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(card.rates)||!card.rates.length)throw new Error('The rate card has no rates.');

// Brands ship either the node-postgres driver or Neon's serverless one; both export Pool.
const driver=await import('pg').catch(async()=>{
  const neon=await import('@neondatabase/serverless');
  neon.neonConfig.webSocketConstructor=(await import('ws')).default;
  return neon;
});
const pool=new driver.Pool({connectionString:url});
try{
  const rows=(await pool.query("SELECT version,payload FROM p5_estimator_policy WHERE id='current'")).rows;
  if(!rows.length){console.error('This brand has no saved estimator policy yet; save one from the admin page first.');process.exit(1);}
  const {version,payload}=rows[0];
  const configuration=typeof payload==='string'?JSON.parse(payload):payload;
  const catalog=configuration.planningCatalog;
  if(!catalog||!Array.isArray(catalog.rates))throw new Error('The saved policy has no planning catalog.');

  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  await writeFile(`p5-policy-backup-${stamp}.json`,JSON.stringify({version,configuration},null,1));

  const existing=new Map(catalog.rates.map(r=>[r.code,r]));
  const added=[],updated=[],kept=[];
  for(const rate of card.rates){
    const entry={code:rate.code,description:rate.description,type:rate.type,unit:rate.unit,amount:rate.amount,
      source:rate.source||card.source,basis:rate.basis||card.basis||'owner-average-cost'};
    const prior=existing.get(entry.code);
    if(!prior){existing.set(entry.code,entry);added.push(entry);continue;}
    if(replace&&(prior.amount!==entry.amount||prior.unit!==entry.unit)){existing.set(entry.code,{...prior,...entry});updated.push(entry);continue;}
    kept.push(entry);
  }
  const rates=[...existing.values()];
  console.log(`catalog ${catalog.rates.length} -> ${rates.length} rates (added ${added.length}, updated ${updated.length}, unchanged ${kept.length})`);
  if(rates.length>500){console.error('A planning catalog may hold at most 500 rates; trim the card and run again.');process.exit(1);}
  for(const rate of added.slice(0,12))console.log(`  + ${rate.code} ${rate.amount} / ${rate.unit}  ${rate.description.slice(0,70)}`);
  if(added.length>12)console.log(`  + ...${added.length-12} more`);
  if(!apply){console.log('Nothing written. Re-run with --apply to save.');process.exit(0);}

  const next={...configuration,planningCatalog:{...catalog,rates,importedAt:new Date().toISOString(),
    source:`${catalog.source} + ${card.source}`.slice(0,500)}};
  const saved=await pool.query("UPDATE p5_estimator_policy SET payload=$1::jsonb,updated_by=$2,updated_at=now(),version=version+1 WHERE id='current' AND version=$3 RETURNING version",
    [JSON.stringify(next),'rate-card-load',version]);
  if(!saved.rows.length){console.error('The policy changed while this ran; nothing was written. Run it again.');process.exit(1);}
  console.log(`saved policy version ${saved.rows[0].version} with ${rates.length} planning rates`);
}finally{await pool.end();}
