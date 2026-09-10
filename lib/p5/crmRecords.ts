import {query} from "./database";
import {ensureSchema} from "./store";

/** Resolve only acknowledged links. Failed or ambiguous sends are not CRM records. */
export async function linkedEstimatorRecords(dealId:number){
  if(!Number.isSafeInteger(dealId)||dealId<=0)throw new Error("Invalid lead identifier");
  await ensureSchema();
  return query(`SELECT DISTINCT ON (o.draft_id) o.draft_id AS id,o.revision,d.brand,o.sent_at
    FROM p5_estimator_outbox o JOIN p5_estimator_drafts d ON d.id=o.draft_id
    WHERE o.destination='crm' AND o.status='sent' AND o.provider_id=$1
    ORDER BY o.draft_id,o.revision DESC`,[String(dealId)]);
}
