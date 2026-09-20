import {crmPayloadBytes,CRM_PAYLOAD_LIMIT_BYTES,CrmPayloadTooLargeError} from './boundedCrmPayload.ts';
import {buildBrandCrmPayload} from './crmPayload.ts';
export {crmPayloadBytes,CrmPayloadTooLargeError};
export const CRM_PAYLOAD_WARNING_BYTES=80*1024;
export const CRM_PAYLOAD_HARD_BYTES=CRM_PAYLOAD_LIMIT_BYTES;
/** This brand's CRM payload (brand identity filled, customer copy projected, bounded or referenced). */
export function crmPayload(record:any,key:string){return buildBrandCrmPayload(record,key).payload;}
export function assertCrmPayloadSize(payload:unknown){
 const bytes=crmPayloadBytes(payload);if(bytes>CRM_PAYLOAD_HARD_BYTES)throw new CrmPayloadTooLargeError(bytes);
 return {bytes,warning:bytes>CRM_PAYLOAD_WARNING_BYTES};
}
