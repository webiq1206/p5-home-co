import type {Metadata} from 'next';
import {ESTIMATOR_BRAND as brand} from './p5/brand.ts';

/** Branded sharing previews are the owner's preference. Product/article schema
 * retains its real subject image. Neither favicon nor preview display is guaranteed. */
export const BRAND_PAGE_IMAGE=`https://${brand.domain}/brand/page-preview.png`;
export const BRAND_SEARCH_ICON=`https://${brand.domain}/brand/search-icon-96.png`;
type Copy={title:string;description:string};
const COPY:Record<string,Record<string,Copy>>={
 construction:{
  '/':{title:'Custom Home Builder in Boise, ID',description:'Build a custom or semi-custom home in Boise and the Treasure Valley. Explore design-build services, build-on-your-lot options and clear project budgets.'},
  '/services':{title:'Home Building & Design-Build Services',description:'Explore custom homes, semi-custom homes, additions and build-on-your-lot services across Boise and the Treasure Valley. Plan your project with our team.'},
  '/about':{title:'About Our Boise Home Building Team',description:'Learn how Boise Construction Co plans and manages Treasure Valley home builds, from lot evaluation and design through permits, construction and handover.'},
  '/contact':{title:'Contact a Boise Home Builder',description:'Discuss your new home, building lot or addition with Boise Construction Co. Call our team or request project guidance for Boise and the Treasure Valley.'},
  '/resources':{title:'Home Building Worksheets & Guides',description:'Download home-building budget worksheets and lot evaluation checklists. Compare Ada and Canyon County permit steps before planning your Idaho build.'},
  '/blog':{title:'Idaho Home Building Advice & Guides',description:'Read practical Idaho home-building guides on budgets, land, permits, design choices and construction timelines from the Boise Construction Co team.'}},
 remodeling:{
  '/':{title:'Remodeling Contractor in Boise, ID',description:'Plan a kitchen, bathroom or whole-home remodel in Boise and the Treasure Valley. Explore design-build services, project scopes and budget guidance.'},
  '/services':{title:'Kitchen, Bath & Home Remodeling',description:'Explore kitchen, bathroom and whole-home remodeling, additions and ADUs in Boise and the Treasure Valley. See the scope of our design-build services.'},
  '/about':{title:'About Our Boise Remodeling Team',description:'Learn how Boise Remodeling Co plans and manages Treasure Valley renovations, including project scopes, design decisions, communication and construction.'},
  '/contact':{title:'Contact Our Boise Remodeling Team',description:'Discuss your kitchen, bathroom or whole-home renovation with Boise Remodeling Co. Call our team or request a consultation for your Treasure Valley project.'}},
 handyman:{
  '/':{title:'Handyman & Home Repairs in Boise, ID',description:'Get help with repairs, installations and home maintenance in Boise and the Treasure Valley. Describe your project or send a repair list for an estimate.'},
  '/services':{title:'Handyman Repair & Installation Services',description:'Explore drywall repair, painting, carpentry, mounting and maintenance services in Boise and the Treasure Valley. Send your repair list to our local team.'},
  '/about':{title:'About Our Boise Handyman Team',description:'Learn how Boise Handyman Co handles Treasure Valley home repairs and installations, with clear project scopes, scheduling and attention to small jobs.'},
  '/contact':{title:'Contact a Boise Handyman',description:'Contact Boise Handyman Co about your repair list, installation or maintenance project. Call our team or send your scope for a Treasure Valley estimate.'}},
 cabinet:{
  '/':{title:'Kitchen Cabinets & Vanities in Boise',description:'Explore kitchen cabinets, bathroom vanities and built-in storage for Boise and the Treasure Valley. Review finishes, design options and installation.'},
  '/about':{title:'About Our Boise Cabinet Team',description:'Learn how Boise Cabinet Co helps Treasure Valley homeowners and contractors with cabinet layouts, finish selections, supply and installation planning.'},
  '/contact':{title:'Contact Our Boise Cabinet Team',description:'Discuss cabinet layouts, finishes, supply or installation with Boise Cabinet Co. Call our team or request help with your Treasure Valley cabinet project.'},
  '/resources':{title:'Cabinet Planning Worksheets & Guides',description:'Plan your cabinetry with budget worksheets, kitchen and bath checklists, and local permit guidance from Boise Cabinet Co in Idaho’s Treasure Valley.'}},
 p5:{
  '/':{title:'Boise Home Construction, Remodeling & Repairs',description:'Find the P5 Home Co team for new construction, remodeling, home repairs or cabinets in Boise and the Treasure Valley. Compare services and plan your project.'},
  '/quote':{title:'Get a Home Project Estimate in Boise',description:'Describe your remodel, new home, cabinet or repair project and attach plans or a scope. Start your Treasure Valley estimate with the right P5 Home Co team.'},
  '/sitemap':{title:'P5 Home Co Pages & Company Directory',description:'Find P5 Home Co pages, project estimate forms and links to our Boise construction, remodeling, handyman and cabinet companies in Idaho’s Treasure Valley.'}}
};
function titleText(meta:Metadata):string{
 const value=meta.title;
 return typeof value==='string'?value:value&&'absolute' in value?value.absolute||brand.name:value&&'default' in value?value.default||brand.name:brand.name;
}
function pagePath(meta:Metadata,hint?:string):string{
 const canonical=meta.alternates?.canonical;
 const value=typeof canonical==='string'?canonical:canonical instanceof URL?canonical.toString():canonical&&typeof canonical==='object'&&'url' in canonical?String(canonical.url):'';
 if(value){try{return new URL(value,`https://${brand.domain}`).pathname.replace(/\/$/,'')||'/';}catch{}}
 return hint&&!hint.includes('[')&&hint!=='__layout__'?(hint.replace(/\/$/,'')||'/'):'';
}
export function withBrandPageMetadata(meta:Metadata,routeHint?:string):Metadata{
 const override=routeHint==='__layout__'?undefined:COPY[brand.id]?.[pagePath(meta,routeHint)];
 const original=titleText(meta);
 const title=override?`${override.title} | ${brand.name}`:original.includes(brand.name)?original:`${original} | ${brand.name}`;
 const description=override?.description||meta.description||undefined;
 const image={url:BRAND_PAGE_IMAGE,width:1200,height:630,alt:`${brand.name} brand seal`};
 const icons=routeHint==='__layout__'?{
  ...(typeof meta.icons==='object'&&!Array.isArray(meta.icons)&&!(meta.icons instanceof URL)?meta.icons:{}),
  icon:[{url:BRAND_SEARCH_ICON,sizes:'96x96',type:'image/png'}],
  apple:[{url:`https://${brand.domain}/brand/search-icon-180.png`,sizes:'180x180',type:'image/png'}],
 }:meta.icons;
 return {
  ...meta,
  ...(override?{title:{absolute:title},description}:{}),
  ...(icons?{icons}:{}),
  openGraph:{...meta.openGraph,title,description,siteName:brand.name,images:[image]},
  twitter:{...meta.twitter,card:'summary_large_image',title,description,images:[BRAND_PAGE_IMAGE]},
 } as Metadata;
}
