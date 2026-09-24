import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {readLearnedLines} from '@/lib/p5/learnedBook';
import {failed} from '@/lib/p5/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Lines priced outside the owner's book and learned from estimates, as CSV for the master spreadsheet. Admin only. */
export async function GET(){
  try{
    await requireEstimatorAdmin();
    const cell=(value:unknown)=>{const raw=String(value??'');const safe=typeof value==='string'&&/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return `"${safe.replace(/"/g,'""')}"`;};
    const rows=(await readLearnedLines()).map(l=>[l.code,l.description,l.unit,l.amount,l.type,l.service,l.learnedAt,l.source,l.status||'review-required',l.location||'',l.finish||'',l.rule?.evidence.validUntil||'',JSON.stringify(l.rule?.evidence||null),JSON.stringify(l.rule?.unitRateContext||null)].map(cell).join(','));
    const csv=['code,description,unit,direct_cost,cost_type,service,learned_at,source,status,location,finish,valid_until,evidence,unit_rate_context',...rows].join('\n');
    return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="learned-price-book-lines.csv"','cache-control':'no-store'}});
  }catch(error){return failed(error);}
}
