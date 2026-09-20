import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {customerPresentation} from './customerProjection.ts';
import {buildCrmPayload as boundedPayload,crmPayloadBytes,CRM_PAYLOAD_LIMIT_BYTES,CRM_ADMIN_PAGE_PATH,CRM_ADMIN_API_PATH,type CrmAdminPath,type CrmPayloadOptions} from './boundedCrmPayload.ts';
/**
 * Sender-side CRM payload entry point for every brand. The pure, bounded
 * builder lives in boundedCrmPayload.ts and is re-exported unchanged; this
 * module adds the brand-aware form used by a brand's delivery adapter.
 */
export * from './boundedCrmPayload.ts';
export const CRM_PAYLOAD_MAX_BYTES=CRM_PAYLOAD_LIMIT_BYTES;
export const CRM_PROJECTION_VERSION='p5-crm-v2';
/**
 * The administrator reference placed in the CRM record. Remodeling's admin page
 * opens ?id=&revision= deep links; the other sender sites reference the
 * authenticated API route until their admin page accepts the same link.
 */
// Every brand ships the same staff page, which opens the referenced estimate and revision from its link.
export const BRAND_CRM_ADMIN_PATH:CrmAdminPath=CRM_ADMIN_PAGE_PATH;
export interface BrandCrmPayload{payload:any;body:string;bytes:number}
/**
 * Brand form: fills brand identity, sends the customer copy through the one
 * customer projection, stamps the projection version and reports the exact
 * serialized size. The saved outbox record is never mutated.
 */
export function buildBrandCrmPayload(record:any,key:string):BrandCrmPayload{
 const source=record&&typeof record==='object'?record:{};
 const projected=source.customer&&typeof source.customer==='object'?customerPresentation(source.customer):source.customer;
 // The builder requires a summary. A summary that was wholly private is
 // withheld from the customer copy, never sent on in its private form.
 const customer=projected&&typeof projected==='object'&&!projected.summary&&typeof source.customer?.summary==='string'&&source.customer.summary.trim()
  ?{...projected,summary:'Scope summary withheld from the customer copy; see the authenticated estimate record.'}:projected;
 const payload:any=boundedPayload({...source,customer,brand:source.brand||brand.name,estimator:source.estimator||'p5-policy'},key,brand.domain,{adminPath:BRAND_CRM_ADMIN_PATH});
 payload.estimate.projectionVersion=CRM_PROJECTION_VERSION;
 return {payload,body:JSON.stringify(payload),bytes:crmPayloadBytes(payload)};
}
/**
 * Two calling forms are supported so every brand's delivery adapter links
 * against the same module:
 *  - buildCrmPayload(record,key,domain[,options]) returns the payload itself
 *    (the bounded builder with this brand's administrator reference; the
 *    caller supplies brand fields).
 *  - buildCrmPayload(record,key) returns {payload,body,bytes} for this brand.
 */
export function buildCrmPayload(record:unknown,key:string,configuredDomain:string,options?:CrmPayloadOptions):ReturnType<typeof boundedPayload>;
export function buildCrmPayload(record:unknown,key:string):BrandCrmPayload;
export function buildCrmPayload(record:unknown,key:string,configuredDomain?:string,options?:CrmPayloadOptions):any{
 return configuredDomain===undefined?buildBrandCrmPayload(record,key):boundedPayload(record,key,configuredDomain,{adminPath:BRAND_CRM_ADMIN_PATH,...options});
}
