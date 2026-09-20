import {ESTIMATOR_VERSION,estimatorRelease} from '@/lib/p5/version';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(){return Response.json({version:ESTIMATOR_VERSION,...estimatorRelease()},{headers:{'cache-control':'no-store'}});}
