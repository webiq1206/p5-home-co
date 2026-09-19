export const SYNTHETIC_ESTIMATOR_FORM='p5-estimator-synthetic-qa';
/** Test campaigns require both an explicit QA name and an authorized mailbox. */
export function estimatorDeliveryMode(name:string,email:string,allowlist=process.env.SYNTHETIC_QA_EMAIL_ALLOWLIST||''):'live'|'synthetic_qa'{
 if(!/^\[QA\](?:\s|$)/i.test(name.trim()))return 'live';
 const normalized=email.trim().toLowerCase();
 if(!normalized.endsWith('@example.invalid')&&!allowlist.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(normalized))
  throw Error('Synthetic estimate delivery requires the configured authorized test mailbox');
 return 'synthetic_qa';
}
