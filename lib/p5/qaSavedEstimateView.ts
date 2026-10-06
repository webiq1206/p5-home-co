import type {EstimateDocument} from './estimateDocument.ts';
import type {customerPresentation} from './presentation.ts';

/** Read-only projection of the one existing synthetic saved estimate. No draft
 * key, source payload, provider evidence or continuation permission crosses it. */
export interface QaSavedEstimateView {
  case:'case-1';
  label:string;
  id:string;
  revision:6;
  result:ReturnType<typeof customerPresentation>;
  document:EstimateDocument;
  delivery:Array<{channel:'suppressed';status:'suppressed'}>;
}
export interface SavedEstimatePreview {
  view:QaSavedEstimateView;
  downloadPdf:()=>Promise<Blob>;
  restore:()=>void;
}
