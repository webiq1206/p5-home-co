import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ESTIMATOR_BRAND} from './brand.ts';
/**
 * Signed links to a saved estimate (owner request 2026-09-22: "Email me when it's ready" must open
 * the correct estimate on any device without repeating the submission, and one customer must not be
 * able to open another's).
 *
 * A draft is protected by a 64-hex key that only the customer's browser holds; the server keeps its
 * hash. An emailed link carries the draft id, an expiry and an HMAC over both instead. Opening it
 * issues a NEW key for that device (store.issueLinkKey); the original key keeps working. Changing the
 * id, the expiry or any character of the signature fails verification, and an expired link is refused.
 */
export const LINK_DAYS=Number(process.env.P5_LINK_DAYS||90);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** P5_LINK_SECRET when set; otherwise derived from server-only configuration that never reaches a browser. */
export function linkSecret():string{
  const configured=(process.env.P5_LINK_SECRET||'').trim();
  if(configured)return configured;
  const base=process.env.DATABASE_URL||process.env.REPLIT_DB_URL||'';
  if(!base)throw new Error('estimate-link-secret-unavailable');
  return createHash('sha256').update(`p5-estimate-link|${base}`).digest('hex');
}
const sign=(purpose:string,value:string)=>createHmac('sha256',linkSecret()).update(`${purpose}|${value}`).digest('base64url').slice(0,32);
export function estimateLinkToken(id:string,now=Date.now(),days=LINK_DAYS):string{
  const expires=Math.floor(now/1000)+Math.round(days*86400);
  return `${expires.toString(36)}.${sign('estimate-link-v1',`${id.toLowerCase()}.${expires}`)}`;
}
export function verifyEstimateLink(id:string,token:string,now=Date.now()):boolean{
  if(!UUID.test(id)||typeof token!=='string'||!/^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{32}$/.test(token))return false;
  const [stamp,signature]=token.split('.');const expires=parseInt(stamp,36);
  if(!Number.isFinite(expires)||expires*1000<now)return false;
  const expected=Buffer.from(sign('estimate-link-v1',`${id.toLowerCase()}.${expires}`));const given=Buffer.from(signature);
  return expected.length===given.length&&timingSafeEqual(expected,given);
}
/** The site's own public origin; the email is sent by, and links back to, the estimator that priced it. */
export function publicOrigin():string{
  const configured=(process.env.P5_PUBLIC_URL||'').trim().replace(/\/+$/,'');
  return configured||`https://${String((ESTIMATOR_BRAND as {domain?:string}).domain||'').replace(/^https?:\/\//,'').replace(/\/+$/,'')}`;
}
export const ESTIMATE_PATH='/estimate/scope';
export function estimateLinkUrl(id:string,now=Date.now()):string{
  return `${publicOrigin()}${ESTIMATE_PATH}?estimate=${encodeURIComponent(id)}&t=${encodeURIComponent(estimateLinkToken(id,now))}`;
}
