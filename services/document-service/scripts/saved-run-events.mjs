/** Query durable metrics, including reviews not yet assigned in this invocation.
 * Metric IDs preserve event order across source and review jobs. */
export async function savedRunEvents(pool,document){
 if(!document)return [];
 return (await pool.query(`SELECT m.stage,m.duration_ms,m.detail,m.created_at,j.kind,j.attempts
  FROM p5ds_metrics m JOIN p5ds_jobs j ON j.id=m.job_id
  WHERE j.tenant=$1 AND j.project=$2 AND
   (j.document_id=$3 OR (j.kind='review' AND j.payload->'documents' @> $4::jsonb))
  ORDER BY m.id`,[document.tenant,document.project,document.id,JSON.stringify([{id:document.id}])])).rows;
}

export const latestProviderFailure=events=>events.filter(e=>e.stage==='provider-failure').at(-1)||null;
