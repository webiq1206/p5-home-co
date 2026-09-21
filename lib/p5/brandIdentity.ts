import {ESTIMATOR_BRAND} from './brand.ts';

/**
 * Who the customer is actually contracting with.
 *
 * Four of the five sites trade under their own name but are the same company:
 * Boise Remodeling Co, Boise Construction Co, Boise Handyman Co and Boise
 * Cabinet Co are DBAs of P5 Home Co, LLC. Anything a customer keeps - an
 * estimate email, the PDF they forward to a spouse or an agent - has to say so
 * plainly, once, where they will see it rather than buried in small print.
 *
 * The parent is read from the brand's own configuration, so a brand that is
 * the parent (P5) names itself and never claims to be a DBA of anything.
 */
const brand=ESTIMATOR_BRAND as unknown as {name:string;legalName?:string|null;parentLegalName?:string|null};
/** The registered company behind this site. */
export const legalEntityName=()=>brand.parentLegalName||brand.legalName||brand.name;
/** True when this site trades under a name other than the company that stands behind it. */
export const tradesAsDba=()=>Boolean(brand.parentLegalName&&brand.parentLegalName!==brand.legalName);
/**
 * One sentence for the footer of every customer document. It reads as a fact about the company,
 * not as a disclaimer, because that is what it is.
 */
export function legalIdentityLine():string{
  return tradesAsDba()
    ? `${brand.name} is a DBA of ${brand.parentLegalName}.`
    : `${brand.name} is operated by ${legalEntityName()}.`;
}
/** Copyright plus the identity line, for a single footer row. */
export function documentFooterLine(now=new Date()):string{
  return `© ${now.getFullYear()} ${legalEntityName()}. ${legalIdentityLine()}`;
}
