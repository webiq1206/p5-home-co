/** Public-safe explanations only. Never expose transport errors, credentials or recipient addresses. */
export const INTAKE_DELIVERY_REASONS={
 'configuration-missing':'Delivery configuration is missing. The site operator must check the existing transport.',
 'runtime-proof-pending':'Delivery awaits verification of the receiving site, sender and original-file access.',
 'crm-contract-pending':'CRM awaits a verified unpriced-request contract, target and revision reconciliation.',
 'crm-disabled':'CRM delivery remains disabled by the existing site setting.',
 'payload-review':'The saved request needs a delivery-format review; its complete contents are retained.',
 'file-delivery-unavailable':'The request is saved, but an original file could not be verified for delivery. No incomplete email was sent; the team must check the retained files.',
 'contact-review':'CRM requires review of the saved contact details. The original request and other delivery channels are retained.',
 'snapshot-conflict':'The saved delivery identity needs operator review before processing.',
 'safe-retry':'A retry with the same delivery identity is scheduled.',
 'uncertain-send':'Acceptance is uncertain. The operator must reconcile this delivery before any resend.',
 'attempt-limit':'Automatic retries have stopped. The operator must reconcile this delivery.',
 'synthetic-suppressed':'Synthetic requests do not send email or create CRM records.',
 'provider-accepted':'The provider accepted this channel. Actual receipt has not been verified.',
} as const;
export type IntakeDeliveryReason=keyof typeof INTAKE_DELIVERY_REASONS;
export type IntakeChannel='customer'|'team'|'crm';
export const INTAKE_CHANNELS:IntakeChannel[]=['customer','team','crm'];
export const deliveryReason=(reason:unknown)=>typeof reason==='string'&&Object.hasOwn(INTAKE_DELIVERY_REASONS,reason)?INTAKE_DELIVERY_REASONS[reason as IntakeDeliveryReason]:'';

/** Release evidence is a reviewed source constant; no public request, environment toggle or
 * admin retry can claim runtime verification. Email: the five brand inboxes, the sender identity
 * and the authenticated original-file links were reviewed for the 2026-10-08 fleet release, so
 * customer and team notifications dispatch through each brand's existing transport once that
 * transport is configured. CRM stays gated until the unpriced-request contract is verified. */
export const INTAKE_RUNTIME_PROOF:{email:string|null;crm:string|null}={email:'fleet-release-2026-10-08',crm:null};
