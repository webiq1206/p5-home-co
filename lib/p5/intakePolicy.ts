/** Public intake policy. Changing automation is a reviewed source change, never a browser option. */
export const INTAKE_SITES = {
  p5: {name:'P5 Home Co',domain:'p5homeco.com'},
  construction: {name:'Boise Construction Co',domain:'boiseconstruction.co'},
  remodeling: {name:'Boise Remodeling Co',domain:'boiseremodeling.co'},
  handyman: {name:'Boise Handyman Co',domain:'boisehandyman.co'},
  cabinet: {name:'Boise Cabinet Co',domain:'boisecabinet.co'},
} as const;
export type IntakeSite = keyof typeof INTAKE_SITES;
/** Owner-approved receiving addresses (2026-10-07). Attribution/team/CRM owner
 * remain separate; aliases converging in a mailbox do not change these recipients. */
export const INTAKE_RECIPIENTS:Record<IntakeSite,string>={p5:'hello@p5homeco.com',construction:'hello@boiseconstruction.co',remodeling:'hello@boiseremodeling.co',handyman:'hello@boisehandyman.co',cabinet:'hello@boisecabinet.co'};
export type PublicProjectMode = 'review'|'automated';
export const PUBLIC_PROJECT_MODES:Record<IntakeSite,{default:PublicProjectMode;services:Record<string,PublicProjectMode>}> = {
  p5:{default:'review',services:{}},construction:{default:'review',services:{}},
  remodeling:{default:'review',services:{}},handyman:{default:'review',services:{}},cabinet:{default:'review',services:{}},
};
export function publicProjectMode(site:string,service=''):PublicProjectMode {
  const policy=Object.hasOwn(PUBLIC_PROJECT_MODES,site)?PUBLIC_PROJECT_MODES[site as IntakeSite]:undefined;
  return policy&&Object.hasOwn(policy.services,service)?policy.services[service]:policy?.default||'review';
}
export function intakeSite(value:unknown):IntakeSite|null {
  return typeof value==='string'&&Object.hasOwn(INTAKE_SITES,value)?value as IntakeSite:null;
}
/** Service is the customer's reviewed whole-project classification, not a keyword found in a file.
 * The existing scope reader proposes it; the review screen always permits a correction. */
const PRIMARY_TEAM:Record<string,IntakeSite>={
  kitchen:'remodeling',bathroom:'remodeling',remodel:'remodeling','whole-home':'remodeling',
  addition:'construction','new-construction':'construction',
  'cabinet-product':'cabinet','cabinet-install':'cabinet',handyman:'handyman',
};
export const SUPPORTING_SERVICES=['cabinetry','plumbing','electrical','heating-and-cooling','flooring-and-tile','painting','site-work','design-and-permits'] as const;
export type SupportingService=typeof SUPPORTING_SERVICES[number];
export interface IntakeRouting {primaryTeam:IntakeSite;teamName:string;supportingServices:SupportingService[];handoff:IntakeSite|null;unresolved:string[]}
export function routeIntake(site:IntakeSite,service:string,supporting:readonly string[]=[]):IntakeRouting {
  const primaryTeam=Object.hasOwn(PRIMARY_TEAM,service)?PRIMARY_TEAM[service]:'p5';
  return {primaryTeam,teamName:INTAKE_SITES[primaryTeam].name,
    supportingServices:[...new Set(supporting)].filter((s):s is SupportingService=>(SUPPORTING_SERVICES as readonly string[]).includes(s)),
    handoff:site==='p5'||site===primaryTeam?null:primaryTeam,
    unresolved:Object.hasOwn(PRIMARY_TEAM,service)?[]:['Confirm the primary project team during review.']};
}
export const INTAKE_COPY={heading:'Tell us about your project',
  introduction:'Share your scope, add photos or plans, and we’ll review the details to prepare your estimate.',
  submit:'Send project request',
  next:'The team will review your scope and uploaded files before preparing an estimate. A site visit or additional information may be needed. We will use your preferred contact method to follow up.'};
