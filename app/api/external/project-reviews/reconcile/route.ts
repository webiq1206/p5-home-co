import {canonicalReviewHttp} from '../../../../../lib/p5/canonicalReviewHttp.ts';
export const runtime='nodejs';
export async function GET(request:Request){return canonicalReviewHttp(request,true);}
