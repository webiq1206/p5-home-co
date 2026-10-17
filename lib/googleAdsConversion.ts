import {finishConversionLabels} from './p5/finishConversion.ts';

/** P5 Home Co runs no Google Ads lead conversion. The shared estimator calls
 * this after an intake confirm or an estimate submit. Brands that advertise
 * implement the send. The third argument is `{accepted:true}` after a saved
 * intake, and `{accepted: data.accepted === true}` after a submit. A replay
 * passes `accepted: false`: the estimator label only, not the form label.
 * A non-OK response, including 409, throws before this is called. */
export function trackGoogleAdsLeadConversion(context:{service?:string}={},dedupeKey?:string,acceptance?:{accepted?:boolean}):boolean{
  void context;
  void dedupeKey;
  void finishConversionLabels(acceptance?.accepted === true);
  return false;
}
