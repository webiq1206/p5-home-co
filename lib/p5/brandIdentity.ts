import {ESTIMATOR_BRAND} from './brand.ts';

/**
 * Who the customer is actually contracting with.
 *
 * Estimator email and the estimate PDF name this brand only:
 * "<brand name> prepared this estimate." The same sentence is used on every
 * brand, so a customer document does not say one company is a DBA of another.
 * The copyright line still names the registered company.
 */
const brand=ESTIMATOR_BRAND as unknown as {name:string;legalName?:string|null;parentLegalName?:string|null};
/** The registered company behind this site. */
export const legalEntityName=()=>brand.parentLegalName||brand.legalName||brand.name;
/** True when this site trades under a name other than the company that stands behind it. */
export const tradesAsDba=()=>Boolean(brand.parentLegalName&&brand.parentLegalName!==brand.legalName);
/** One sentence on every customer estimate. It names this brand and no other company. */
export function legalIdentityLine():string{
  return `${brand.name} prepared this estimate.`;
}
/** Copyright plus the identity line, for a single footer row. */
export function documentFooterLine(now=new Date()):string{
  return `© ${now.getFullYear()} ${legalEntityName()}. ${legalIdentityLine()}`;
}
