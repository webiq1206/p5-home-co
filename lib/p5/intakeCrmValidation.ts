import {validateInboundLead} from '../../app/lib/leads/normalize.ts';
import {intakeLocalCrmRecord} from './intakeDeliveryPayload.ts';
import type {IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';
import type {IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';

/** Actual local receiver validation before recording any CRM side-effect intent. */
export function validateIntakeLocalCrm(envelope:IntakeDeliveryEnvelope):IntakeDeliveryReason|null{
 try{
  const s=envelope.request;if(!s)return 'payload-review';
  const record=intakeLocalCrmRecord(s),names=s.contact.name.trim().split(/\s+/);
  const errors=validateInboundLead({firstName:names.shift()||null,lastName:names.join(' ')||null,email:s.contact.email||null,phone:s.contact.phone||null,
   brand:record.brand,projectType:s.scope.answers.service||null,source:'Organic Website',sourceDetail:`p5-estimator:${s.draftId}`,
   propertyAddress:s.scope.answers.address||null,propertyCity:s.scope.answers.location||null,summary:record.customer.summary,externalLeadId:envelope.leadKey,
   originalForm:'p5-estimator',originalCampaign:null,utm:null,receivedAt:new Date(s.savedAt)});
  return errors.length?'contact-review':null;
 }catch{return 'payload-review';}
}
