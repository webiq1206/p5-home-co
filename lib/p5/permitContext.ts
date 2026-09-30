import type {ReviewedScope} from './scope.ts';

/** Official applicability context, never a fee schedule or a blanket permit
 * exemption. Boise metro pricing geography alone is not city jurisdiction. */
export function verifiedPermitContext(scope:Pick<ReviewedScope,'answers'>,now=new Date()){
 if(!/^boise(?:,?\s+(?:idaho|id))?$/i.test((scope.answers.location||'').trim()))return null;
 const checkedAt='2026-09-30';
 const age=now.getTime()-Date.parse(checkedAt+'T00:00:00Z');
 if(age<0||age>90*86400000)return null;
 return {jurisdiction:'City of Boise',checkedAt,
  source:'https://www.cityofboise.org/departments/planning-and-development-services/building/homeowners-guide/',
  guidance:'The city guide exempts painting, floor coverings, cabinets, countertops and wall coverings from building permits. It identifies exposed framing, new partitions, fixture relocation and new or changed openings as permit triggers. This does not exempt electrical, plumbing or mechanical work, window replacement, or changes affecting safety. Match the actual requested work to a stated trigger; a remodel label alone does not establish a permit or fee. Unchanged interior door openings do not establish a new opening.',
  limitation:'This is applicability guidance, not a permit determination or price. Preserve explicitly requested permit services. Identify any remaining trigger or jurisdiction uncertainty; confirm requirements before construction.'};
}
