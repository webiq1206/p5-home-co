// Generate lib/p5/rateCardData.ts from scripts/p5-boise-rate-card.json.
//
// The JSON is the editable source of truth; the generated module is what the
// deployed server reads, because `scripts/` is not traced into the standalone
// build. The module is imported only by server code, so the rates never reach
// a browser bundle. Run this after editing the card:
//   node scripts/p5-build-rate-card.mjs
import {readFile,writeFile} from 'node:fs/promises';
const card=JSON.parse(await readFile('scripts/p5-boise-rate-card.json','utf8'));
const rates=card.rates.map(r=>({code:r.code,description:r.description,type:r.type,unit:r.unit,amount:r.amount,
  source:r.source||card.source,basis:r.basis||card.basis||'owner-average-cost'}));
const body=`// Generated from scripts/p5-boise-rate-card.json by scripts/p5-build-rate-card.mjs. Do not edit by hand.
import type {PlanningRate} from './planningBooks.ts';
/** ${card.note} */
export const RATE_CARD_SOURCE=${JSON.stringify(card.source)};
export const RATE_CARD:PlanningRate[]=${JSON.stringify(rates,null,1)};
`;
await writeFile('lib/p5/rateCardData.ts',body);
console.log(`wrote lib/p5/rateCardData.ts with ${rates.length} rates`);
