import {createHash} from "node:crypto";
import type {AnalysisResult} from "./extraction.ts";
import type {ScopeAnswers,ScopeUpload} from "./scope.ts";

type LegacyInput={kind?:string;draft?:{uploads?:Array<{id?:string;sha256?:string}>};text?:string;answers?:ScopeAnswers};
export type CompletedAnalysisCandidate={workKey:string;payload:unknown};
export type AnalysisReuseInput={text:string;answers:ScopeAnswers;uploads:ScopeUpload[]};
export type ReusableAnalysis={version:string;analysis:AnalysisResult};

const stableAnswers=(answers:ScopeAnswers)=>{
  const entries=Object.entries(answers||{})
    .filter(([field])=>field!=="service")
    .sort(([a],[b])=>a.localeCompare(b));
  return JSON.stringify(entries);
};
const uploadIdentity=(uploads:Array<{id?:string;sha256?:string}>|ScopeUpload[])=>JSON.stringify(
  uploads.map(upload=>[String(upload.id||""),String(upload.sha256||"")]),
);
const hashVersion=(input:AnalysisReuseInput)=>createHash("sha256")
  .update(JSON.stringify([input.text,input.answers,input.uploads.map(file=>[file.id,file.sha256])]))
  .digest("hex");

function asLegacyInput(value:unknown):LegacyInput|null{
  if(!value||typeof value!=="object")return null;
  const input=(value as {input?:unknown}).input;
  if(!input||typeof input!=="object")return null;
  return input as LegacyInput;
}

/** A legacy result is reusable only when its complete source identity is exact. */
export function compatibleLegacyAnalysis(candidate:CompletedAnalysisCandidate,current:AnalysisReuseInput):{ok:true;reusable:ReusableAnalysis}|{ok:false;reason:string}{
  const payload=candidate.payload as {input?:unknown;state?:unknown;result?:{analysis?:unknown}};
  if(payload?.state!=="complete")return {ok:false,reason:"analysis-not-complete"};
  const input=asLegacyInput(payload);
  if(!input||input.kind!=="analysis")return {ok:false,reason:"analysis-input-missing"};
  if(input.text!==current.text)return {ok:false,reason:"source-text-mismatch"};
  if(uploadIdentity(input.draft?.uploads||[])!==uploadIdentity(current.uploads))return {ok:false,reason:"upload-identity-mismatch"};
  const legacyAnswers=input.answers||{};
  if(Object.prototype.hasOwnProperty.call(legacyAnswers,"service")&&legacyAnswers.service)return {ok:false,reason:"legacy-service-conflict"};
  if(current.answers.service!=="cabinet-install")return {ok:false,reason:"current-service-incompatible"};
  if(stableAnswers(legacyAnswers)!==stableAnswers(current.answers))return {ok:false,reason:"manual-answer-mismatch"};
  const analysis=payload.result?.analysis as AnalysisResult|undefined;
  if(!analysis||typeof analysis!=="object")return {ok:false,reason:"analysis-result-missing"};
  if(typeof analysis.provider!=="string"||!analysis.provider||typeof analysis.model!=="string"||!analysis.model||typeof analysis.analyzedAt!=="string"||!analysis.analyzedAt)return {ok:false,reason:"analysis-provenance-missing"};
  if(!analysis.extraction||!Array.isArray(analysis.extraction.reviewNotes))return {ok:false,reason:"analysis-extraction-missing"};
  if(analysis.extraction.reviewNotes.length)return {ok:false,reason:"analysis-has-review-notes"};
  return {ok:true,reusable:{version:hashVersion(current),analysis}};
}

/** More than one exact legacy match is unsafe: callers must run a fresh read. */
export function selectReusableAnalysis(candidates:CompletedAnalysisCandidate[],current:AnalysisReuseInput):{reusable:ReusableAnalysis|null;reason?:string}{
  const matches=candidates.map(candidate=>compatibleLegacyAnalysis(candidate,current)).filter((result):result is {ok:true;reusable:ReusableAnalysis}=>result.ok);
  if(matches.length>1)return {reusable:null,reason:"multiple-compatible-analyses"};
  return matches.length?{reusable:matches[0].reusable}:{reusable:null,reason:"no-compatible-analysis"};
}