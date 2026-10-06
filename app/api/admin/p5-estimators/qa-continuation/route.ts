import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {qaContinuationHandlers} from '@/lib/p5/qaContinuationEndpoint';
export const {GET,POST}=qaContinuationHandlers(requireEstimatorAdmin);
export const runtime='nodejs';
export const dynamic='force-dynamic';
