import {intakeAdminHandlers} from '@/lib/p5/intakeAdmin';
import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {query} from '@/lib/p5/database';
import {readStoredBytes} from '@/lib/p5/objectStorage';
import {ESTIMATOR_BRAND} from '@/lib/p5/brand';
import {intakeSite} from '@/lib/p5/intakePolicy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=intakeAdminHandlers({site:intakeSite(ESTIMATOR_BRAND.id)!,authorize:requireEstimatorAdmin,query,readBytes:readStoredBytes}).get;
