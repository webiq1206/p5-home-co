import {getIntakeTransfer,postIntakeTransfer} from '@/lib/p5/intakeTransferEndpoint';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=getIntakeTransfer;
export const POST=postIntakeTransfer;
