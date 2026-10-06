import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {qaSavedEstimateHandlers} from '@/lib/p5/qaSavedEstimateEndpoint';
export const {GET}=qaSavedEstimateHandlers(requireEstimatorAdmin);
export const runtime='nodejs';
export const dynamic='force-dynamic';
