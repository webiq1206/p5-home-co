import {after} from "next/server";
import {postSubmission} from "@/lib/p5/submitEndpoint";
import {decorateEstimatorSubmission} from "@/lib/p5/enhancedConversionSuppression";
// p5homeco opts in here. A brand copy of this route should pass false until that brand chooses suppression.
const ENHANCED_CONVERSION_SUPPRESSION = true;
export async function POST(request:Request){
  const response = await postSubmission(request, task => after(task));
  return decorateEstimatorSubmission(response, ENHANCED_CONVERSION_SUPPRESSION);
}
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
