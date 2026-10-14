import {canonicalReviewHttp} from '../../../../lib/p5/canonicalReviewHttp.ts';
export const runtime='nodejs';
export async function POST(request:Request){return canonicalReviewHttp(request);}
