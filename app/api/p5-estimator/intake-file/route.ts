import {intakeFileHandler} from '@/lib/p5/intakeFileAccess';
import {query} from '@/lib/p5/database';
import {readStoredBytes} from '@/lib/p5/objectStorage';
import {linkSecret} from '@/lib/p5/estimateLinks';
import {ESTIMATOR_BRAND} from '@/lib/p5/brand';
import {intakeSite} from '@/lib/p5/intakePolicy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=intakeFileHandler({site:intakeSite(ESTIMATOR_BRAND.id)!,query,readBytes:readStoredBytes,secret:linkSecret});
