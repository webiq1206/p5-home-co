import {UNIT_REGISTRY,unitKey} from './unitRates.ts';

type Powers=Record<string,number>;
export interface ProjectUnit {powers:Powers;scale:number}
const clean=(powers:Powers)=>Object.fromEntries(Object.entries(powers).filter(([,exponent])=>exponent!==0).sort(([a],[b])=>a.localeCompare(b)));
export const sameProjectDimension=(a:ProjectUnit,b:ProjectUnit)=>JSON.stringify(clean(a.powers))===JSON.stringify(clean(b.powers));
export function combineProjectUnits(a:ProjectUnit,b:ProjectUnit,divide=false):ProjectUnit{
 const powers={...a.powers};for(const [dimension,exponent]of Object.entries(b.powers))powers[dimension]=(powers[dimension]||0)+(divide?-exponent:exponent);
 return {powers:clean(powers),scale:divide?a.scale/b.scale:a.scale*b.scale};
}
/** Physical dimensional algebra, independent of project category. Counted
 * containers and working periods retain their identity: one box is not one
 * piece, and a labor day does not assert any number of working hours. */
export function projectUnit(unit:string):ProjectUnit|null{
 const parts=unit.trim().split(/\s*\/\s*|\s+per\s+/i);
 if(parts.length===2){const a=projectUnit(parts[0]),b=projectUnit(parts[1]);return a&&b?combineProjectUnits(a,b,true):null;}
 if(parts.length!==1)return null;
 const key=unitKey(unit);
 const extra:Record<string,[number,number]>={in:[1,1/12],inch:[1,1/12],inches:[1,1/12],ft:[1,1],feet:[1,1],foot:[1,1],m:[1,3.280839895013123],mm:[1,.003280839895013123],cm:[1,.03280839895013123],m2:[2,10.763910416709722],m3:[3,35.31466672148859],cf:[3,1],ft3:[3,1],'cubic feet':[3,1],'cubic foot':[3,1]};
 if(key==='scalar'||key==='dimensionless')return {powers:{},scale:1};
 if(extra[key])return {powers:{length:extra[key][0]},scale:extra[key][1]};
 const known=UNIT_REGISTRY[key];if(!known)return null;
 const spatial:Record<string,number>={length:1,area:2,volume:3};
 const powers=spatial[known.dimension]?{length:spatial[known.dimension]}:{[['count','time','lump'].includes(known.dimension)?known.dimension+':'+key:known.dimension]:1};
 const scales:Record<string,number>={sy:9,square:100,acre:43560,ton:2000,cy:27,gallon:231/1728};
 return {powers,scale:scales[key]||1};
}
/** Numeric transcription checks only. Whether a number measures the asserted
 * physical subject still requires source/context review. */
export function sourceNumbers(source:string):number[]{
 const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
 const text=source.replace(/(\d)([¼½¾⅐-⅞])/g,'$1 $2').normalize('NFKC').replace(/(\d),(?=\d{3}\b)/g,'$1').replace(/\b[a-z]+\b/gi,word=>Object.hasOwn(words,word.toLowerCase())?String(words[word.toLowerCase()]):word);
 const values=[...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(match=>Number(match[0]));
 for(const match of text.matchAll(/(?<![\d.])(?:(\d+)[ -])?(\d+)\s*[\/⁄]\s*(\d+)/g)){
  const denominator=Number(match[3]);if(denominator>0)values.push(Number(match[1]||0)+Number(match[2])/denominator);
 }
 return values;
}
