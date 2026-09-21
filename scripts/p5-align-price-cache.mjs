// Make this workspace's database agree with production about p5_estimator_price_cache.
//
// The first version of the saved-price cache kept its rows in a table of its own. Saved prices now
// live in p5_estimator_policy instead, because a table of their own turned every publish into a
// database review. Where that first version already ran, production still holds the table - and a
// publish then proposes DROP TABLE ... CASCADE to bring production back in line with a workspace
// that never had it.
//
// Dropping it would only lose a cached price that would be recomputed anyway, but a publish should
// not have to destroy anything to ship a cache. This creates the same empty table in the workspace
// database, so the two agree and the migration has nothing to do. It only ever CREATEs, never drops
// and never writes a row.
//
// Where production never had the table either, the other direction is cleaner: remove the unused
// copy from this workspace so both sides have nothing and the migration is empty. --remove does
// that, and refuses outright unless the table exists here and holds no rows. It only ever touches
// the database this workspace is pointed at; production is never modified by this script.
//
//   node scripts/p5-align-price-cache.mjs           shows what it would do
//   node scripts/p5-align-price-cache.mjs --apply   creates the table if it is missing
//   node scripts/p5-align-price-cache.mjs --remove  drops it here, only when it is empty
const apply=process.argv.includes('--apply');
const remove=process.argv.includes('--remove');
const url=process.env.DATABASE_URL||process.env.PGDATABASE_URL;
if(!url){console.error('DATABASE_URL is not set; run this inside the workspace shell.');process.exit(1);}

const driver=await import('pg').catch(async()=>{
  const neon=await import('@neondatabase/serverless');
  neon.neonConfig.webSocketConstructor=(await import('ws')).default;
  return neon;
});
const pool=new driver.Pool({connectionString:url});
try{
  const [{exists}]=(await pool.query("SELECT to_regclass('public.p5_estimator_price_cache') IS NOT NULL AS exists")).rows;
  if(remove){
    if(!exists){console.log('p5_estimator_price_cache is not in this database; nothing to remove.');process.exit(0);}
    const [{count}]=(await pool.query('SELECT count(*)::int AS count FROM p5_estimator_price_cache')).rows;
    if(count>0){console.error(`Refusing to remove it: this copy holds ${count} saved price(s). Nothing was changed.`);process.exit(1);}
    await pool.query('DROP TABLE p5_estimator_price_cache');
    console.log('removed the empty table from this workspace; a publish should now propose no database change.');
    process.exit(0);
  }
  if(exists){console.log('p5_estimator_price_cache is already present here; a publish will propose no change to it.');process.exit(0);}
  console.log('p5_estimator_price_cache is missing from this database, so a publish would propose dropping it in production.');
  if(!apply){console.log('Nothing written. Re-run with --apply to create the empty table.');process.exit(0);}
  await pool.query(`CREATE TABLE IF NOT EXISTS p5_estimator_price_cache (
    fingerprint text PRIMARY KEY, payload jsonb NOT NULL, document text,
    created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz NOT NULL DEFAULT now(),
    uses integer NOT NULL DEFAULT 0)`);
  await pool.query('CREATE INDEX IF NOT EXISTS p5_estimator_price_cache_document ON p5_estimator_price_cache(document,created_at DESC)');
  console.log('created the empty table; publish again and the migration should be empty.');
}finally{await pool.end();}
