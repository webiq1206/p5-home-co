/** P5 Home Co runs no Google Ads lead conversion. The shared estimator calls
 * this after an accepted estimate; brands that advertise implement it. */
export function trackGoogleAdsLeadConversion(_context:{service?:string}={},_dedupeKey?:string):boolean{return false;}
