import {reportEstimatorProgress} from "../../app/quote/estimatorSession";
import type {BrowserDraft} from './browserDraft';
export const RE10_EVENTS={started:'re10_estimator_started',documentUploaded:'re10_document_uploaded',analysisCompleted:'re10_analysis_completed',analysisFailed:'re10_analysis_failed',repairsConfirmed:'re10_repairs_confirmed',contactViewed:'re10_contact_viewed',contactSubmitted:'re10_contact_submitted',estimateGenerated:'re10_estimate_generated',estimateEmailed:'re10_estimate_emailed',onsiteRequested:'re10_onsite_requested',additionalDocuments:'re10_additional_documents'} as const;
export function trackScopeEvent(event:keyof typeof RE10_EVENTS,service?:string){
  if(typeof window==='undefined')return;
  const name=service==='re10'?RE10_EVENTS[event]:'p5_estimator_'+event;
  try{(window as any).gtag?.('event',name,{service:service||'unknown',estimator:'unified'});}catch{}
}
export function reportProgress(d:BrowserDraft,status:'active'|'completed'){
  reportEstimatorProgress({flow:d.answers.service==='re10'?'re10':'estimate',currentStep:['project','details','contact'][d.step]||'project',currentStepIndex:d.step,totalSteps:3,selections:{project:d.answers.service||'',sqft:d.answers.sqft||'',finish:d.answers.finish||'',files:d.uploads?.length||0},status});
}
