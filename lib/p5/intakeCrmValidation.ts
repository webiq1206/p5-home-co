import {collectAttribution,sourceFromAttribution} from "../../app/lib/leads/attribution.ts";
import {validateInboundLead} from '../../app/lib/leads/normalize.ts';
import {BRANDS,type Brand,type InboundLead} from '../../app/lib/leads/types.ts';
import {projectRequestHold,projectRequestLead} from './p5LeadIntake.ts';
import type {IntakeDeliveryEnvelope} from './intakeDeliveryPayload.ts';
import type {IntakeDeliveryReason} from './intakeDeliveryPolicy.ts';

/**
 * A visitor's unpriced project request as the lead this site's own lead system saves (owner decision,
 * 18 November 2026). The fields come from `projectRequestLead()` in p5LeadIntake.ts, the same builder a
 * brand site posts from, so a request reads the same whichever site took it: the brand is the PRIMARY
 * TEAM it was routed to, the form is `p5-project-request`, and its id is the request's lead key, one
 * per project across revisions. There is no price in it.
 */
export function intakeInboundLead(envelope:IntakeDeliveryEnvelope):InboundLead{
 const lead=projectRequestLead(envelope);
 if(!(BRANDS as readonly string[]).includes(lead.brand))throw new Error('payload-review');
 const names=lead.name.split(/\s+/).filter(Boolean);
 const attribution=collectAttribution(lead.attribution);
 return {firstName:names.shift()||null,lastName:names.join(' ')||null,email:lead.email||null,phone:lead.phone||null,
  brand:lead.brand as Brand,projectType:lead.projectType||null,source:sourceFromAttribution(attribution),sourceDetail:lead.sourceDetail,
  propertyAddress:lead.address||null,propertyCity:lead.city||null,summary:lead.message,externalLeadId:lead.externalId,
  originalForm:lead.form,originalCampaign:attribution?.utm_campaign||null,utm:attribution,receivedAt:new Date(lead.savedAt),
  // The same key as a brand request id, so the lead is found by it even when this request joined a lead that was already open.
  brandExternalId:lead.externalId,requestKind:'quote',
  contactPreference:lead.contactPreference==='phone'?'call':lead.contactPreference==='email'?'email':null};
}

/** Actual local receiver validation before recording any CRM side-effect intent. Reads the envelope only. */
export function validateIntakeLocalCrm(envelope:IntakeDeliveryEnvelope):IntakeDeliveryReason|null{
 try{
  const held=projectRequestHold(envelope);if(held)return held;
  return validateInboundLead(intakeInboundLead(envelope)).length?'contact-review':null;
 }catch{return 'payload-review';}
}
