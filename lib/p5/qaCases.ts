import {ESTIMATOR_BRAND} from './brand.ts';
export const QA_CASES={
  'case-1':['84fe60ee-eea3-40cc-9ad1-8e7ea41aec98','Synthetic case 1'],
  remodel:['4b984f15-af82-41ff-b181-e16696ea779a','Remodel'],
  kitchen:['62237df6-5a8a-4226-b5cc-ad4297bdf6d1','Kitchen'],
  'case-4':['225edc58-a47d-4171-8630-72dd6abf5845','Synthetic case 4'],
  'case-5':['2ba6de3d-d9e5-43f0-bc48-c80a534fc6dc','Synthetic case 5'],
  'case-6':['df96b75c-07ec-4833-a6f2-aabe01a5bf97','Synthetic case 6'],
} as const;
const ids=new Set<string>(Object.values(QA_CASES).map(([id])=>id));
export const isOperatorQaCase=(id:string)=>ESTIMATOR_BRAND.domain==='p5homeco.com'&&ids.has(id);
export const QA_OPERATION_KEY='qa-operator-lease-v1';
