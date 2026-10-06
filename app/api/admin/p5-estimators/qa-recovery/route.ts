import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {qaSavedReadingHandlers} from '@/lib/p5/qaSavedReadingEndpoint';

export const {GET,POST}=qaSavedReadingHandlers(requireEstimatorAdmin);
export const runtime='nodejs';
export const dynamic='force-dynamic';
