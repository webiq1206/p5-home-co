import {SCOPE_FIELDS,type ScopeField} from './scope.ts';
import {cabinetWidthFeet} from './cabinetMeasurements.ts';

/** What a customer's sentence said about one numeric question.
 *
 * `value` is the number in the field's own unit, ready for `validateAnswer`.
 * `note` is what the customer added around the number ("only the bathroom
 * floor"). It is kept as scope wording and never discarded.
 * `choices` is returned instead of a value when the sentence holds more than
 * one number that could answer the question, so the estimator can ask which
 * one was meant rather than guess. */
export type NumericAnswer={value:string;note?:string}|{choices:string[];note?:string};

type Dimension='area'|'length'|'count'|'hours'|'months';
const DIMENSIONS:Partial<Record<ScopeField,Dimension>>={sqft:'area',garageSqft:'area',coveredOutdoorSqft:'area',flooringSqft:'area',tileSqft:'area',countertopSqft:'area',demolitionSqft:'area',cabinetTallLf:'length',cabinetBaseLf:'length',cabinetUpperLf:'length',trimLf:'length',length:'length',width:'length',rooms:'count',bathrooms:'count',stories:'count',fixtureCount:'count',laborHours:'hours',projectMonths:'months'};
const UNIT_WORDS:Record<Dimension,RegExp>={
  area:/^(?:sq\.?\s*f(?:ee|oo)?t\.?|square\s*f(?:ee|oo)t|sf|sqft|ft2|ft²|s\.f\.)/i,
  length:/^(?:linear\s*f(?:ee|oo)t|lineal\s*f(?:ee|oo)t|lin\.?\s*ft\.?|lf|l\.f\.|f(?:ee|oo)t|ft\.?|')/i,
  count:/^(?:rooms?|bath(?:room)?s?|stor(?:y|ies)|floors?|levels?|fixtures?|each|ea\b)/i,
  hours:/^(?:hours?|hrs?\.?)/i,
  months:/^(?:months?|mos?\.?)/i,
};
const ANY_UNIT=/^(?:sq\.?\s*f(?:ee|oo)?t\.?|square\s*f(?:ee|oo)t|sf\b|sqft|ft2|ft²|linear\s*f(?:ee|oo)t|lineal\s*f(?:ee|oo)t|lf\b|f(?:ee|oo)t\b|ft\b\.?|'|inch(?:es)?\b|in\b\.?|"|rooms?\b|bath(?:room)?s?\b|bed(?:room)?s?\b|stor(?:y|ies)\b|floors?\b|fixtures?\b|hours?\b|hrs?\b|months?\b|weeks?\b|days?\b|years?\b|yards?\b|doors?\b|windows?\b|cabinets?\b|%|percent\b)/i;
const WORDS:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const WORD_NUMBER=new RegExp(`\\b(?:(${Object.keys(WORDS).filter(w=>WORDS[w]>=20).join('|')})[\\s-]+)?(${Object.keys(WORDS).join('|')})(?:\\s+(hundred|thousand))?\\b`,'gi');

const clean=(n:number)=>String(Math.round(n*100)/100);
type Found={value:number;start:number;end:number;unit:string;matches:boolean;foreign:boolean};

function numbersIn(text:string,dimension:Dimension):Found[]{
  const found:Found[]=[];
  const push=(value:number,start:number,end:number)=>{
    const rest=text.slice(end).replace(/^[\s-]+/,'');const unit=(rest.match(ANY_UNIT)||[''])[0];
    const matches=UNIT_WORDS[dimension].test(rest);
    found.push({value,start,end:end+(unit?text.slice(end).indexOf(unit)+unit.length:0),unit,matches,foreign:Boolean(unit)&&!matches});
  };
  for(const m of text.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d,]*\d)/g))push(Number((m[1]+(m[2]||'')).replaceAll(',','')),m.index,m.index+m[0].length);
  for(const m of text.matchAll(WORD_NUMBER)){
    if(found.some(f=>m.index>=f.start&&m.index<f.end))continue;
    let value=(m[1]?WORDS[m[1].toLowerCase()]:0)+WORDS[m[2].toLowerCase()];
    if(m[1]&&WORDS[m[2].toLowerCase()]>=10)continue;
    if(m[3])value*=m[3].toLowerCase()==='hundred'?100:1000;
    // "one" is usually a pronoun or article ("the one bathroom"); accept it only with a unit.
    if(m[2].toLowerCase()==='one'&&!m[1]&&!m[3]&&!ANY_UNIT.test(text.slice(m.index+m[0].length).replace(/^[\s-]+/,'')))continue;
    push(value,m.index,m.index+m[0].length);
  }
  return found.sort((a,b)=>a.start-b.start);
}

/** Explicit numeric tokens, including the same spoken-number forms accepted
 * by numeric questions. This establishes presence, not measurement role. */
export const explicitAnswerNumbers=(text:string):number[]=>numbersIn(text,'count').map(item=>item.value);

/** Feet and inches written as 12'6", 12 ft 6 in or 12 feet 6 inches. */
function feetInches(text:string):{value:number;start:number;end:number}|null{
  const m=text.match(/(\d+(?:\.\d+)?)\s*(?:'|ft\.?|f(?:ee|oo)t)\s*(\d+(?:\.\d+)?)\s*(?:"|in\.?|inch(?:es)?)/i);
  return m&&m.index!==undefined?{value:Number(m[1])+Number(m[2])/12,start:m.index,end:m.index+m[0].length}:null;
}

function noteFrom(text:string,spans:{start:number;end:number}[]):string|undefined{
  let rest=text;for(const span of [...spans].sort((a,b)=>b.start-a.start))rest=rest.slice(0,span.start)+' '+rest.slice(span.end);
  rest=rest.replace(/\b(?:it(?:'s| is)|that(?:'s| is)|about|approximately|approx\.?|around|roughly|maybe|i think|probably|total|in total|or so|just|is|are|of|there (?:is|are)|we have|it has)\b/gi,' ').replace(/[\s,.;:!-]+/g,' ').trim();
  return rest.length>=4&&/[a-z]{3}/i.test(rest)?text.trim():undefined;
}

/** Read a number out of a natural-language answer to a numeric question.
 * Returns null when the sentence holds no usable number, so the caller can
 * treat it as extra project detail instead. Never invents a value. */
export function parseNumericAnswer(field:ScopeField,answer:string):NumericAnswer|null{
  if(SCOPE_FIELDS[field]?.kind!=='number')return null;
  const dimension=DIMENSIONS[field]||'count';const text=answer.trim();if(!text||text.length>600)return null;
  if(/^(?:none|no|nope|n\/a|zero|0|nothing|not any|there (?:is|are) (?:none|no\b.*))[\s.!]*$/i.test(text)||/^no\s+(?:garage|tall|upper|base|tile|trim|covered|outdoor)\b/i.test(text))return {value:'0',note:/^(?:none|no|nope|n\/a|zero|0|nothing)[\s.!]*$/i.test(text)?undefined:text};
  if(dimension==='area'){
    // A trailing unit applies to both dimensions: 12 by 12 inches is 1 SF.
    // Explicit mixed units are converted independently; unlabelled dimensions
    // retain the field's established feet convention.
    const m=text.match(/(\d+(?:\.\d+)?)\s*(inches\b|inch\b|in\b\.?|"|feet\b|foot\b|ft\b\.?|')?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(inches\b|inch\b|in\b\.?|"|feet\b|foot\b|ft\b\.?|')?/i);
    if(m&&m.index!==undefined){
      const trailing=text.slice(m.index+m[0].length).trimStart();
      if(/^(?:mm|cm|m|meters?|metres?|yards?|yd)\b/i.test(trailing))return null;
      const firstUnit=m[2]||m[4]||'ft',secondUnit=m[4]||m[2]||'ft';
      const feet=(n:string,unit:string)=>Number(n)*(/^(?:in|")/i.test(unit)?1/12:1);
      const computed=clean(feet(m[1],firstUnit)*feet(m[3],secondUnit));
      const stated=numbersIn(text,'area').filter(n=>n.matches).map(n=>clean(n.value));
      const choices=[...new Set([computed,...stated])];
      if(choices.length>1)return {choices:choices.slice(0,4),note:text};
      return {value:computed,note:text};
    }
  }
  if(dimension==='length'){
    const cabinetWidth=cabinetWidthFeet(field,text);
    if(cabinetWidth!==null){
      const statedFeet=numbersIn(text,'length').filter(item=>item.matches);
      if(statedFeet.some(item=>Math.abs(item.value-cabinetWidth)>.005))return null;
      return {value:clean(cabinetWidth),note:text};
    }
    // A standalone inch answer is a length in the field's canonical feet.
    // Keep compound dimensions for attributed-width parsing or clarification.
    const inches=text.match(/^(\d+(?:\.\d+)?)\s*(?:inches|inch|in\.?|")[\s.]*$/i);
    if(inches)return {value:clean(Number(inches[1])/12)};
    const mixed=feetInches(text);if(mixed)return {value:clean(mixed.value),note:noteFrom(text,[mixed])};
  }
  // A stated range ("35 to 40 square feet") is two possible answers, not one.
  const range=text.match(/(\d+(?:\.\d+)?)\s*(?:to|or|-|–)\s*(\d+(?:\.\d+)?)/i);
  if(range&&range[1]!==range[2])return {choices:[clean(Number(range[1])),clean(Number(range[2]))],note:text};
  const found=numbersIn(text,dimension);if(!found.length)return null;
  const matching=found.filter(f=>f.matches);const neutral=found.filter(f=>!f.unit);
  // A number carrying this question's unit wins; otherwise a lone bare number;
  // numbers carrying another unit ("2 bathrooms" in an area answer) never answer it.
  const candidates=matching.length?matching:neutral;
  if(!candidates.length)return null;
  // Installed area and material purchase area are different quantities, not
  // contradictory answers. Resolve only explicitly labelled roles and keep the
  // entire sentence, so waste and purchase requirements still reach pricing.
  if(['flooringSqft','tileSqft'].includes(field)&&matching.length>1){
    const roles=new Map<string,Set<string>>();
    for(const clause of text.split(/[,;\n]|\.(?=\s|$)|\b(?:and|but|versus|vs)\b(?=[^,;.\n]*\d)/i)){
      const amounts=numbersIn(clause,'area').filter(n=>n.matches);
      if(amounts.length!==1)continue;
      const installed=/\b(?:installed|install(?:ation)?\s+area|net\s+(?:floor\s+)?area|floor\s+area|finished\s+area|coverage)\b/i.test(clause);
      const purchased=/\b(?:purchas(?:e|ed|ing)|order(?:ed|ing)?|buy|waste|spare)\b/i.test(clause);
      if(installed===purchased)continue;
      const key=clean(amounts[0].value),kinds=roles.get(key)||new Set<string>();
      kinds.add(installed?'installed':'purchased');roles.set(key,kinds);
    }
    const values=[...new Set(matching.map(n=>clean(n.value)))];
    const installed=values.filter(value=>roles.get(value)?.size===1&&roles.get(value)?.has('installed'));
    if(installed.length===1&&values.every(value=>value===installed[0]||(roles.get(value)?.size===1&&roles.get(value)?.has('purchased'))))return {value:installed[0],note:text};
  }
  const distinct=[...new Set(candidates.map(c=>clean(c.value)))];
  if(distinct.length>1)return {choices:distinct.slice(0,4),note:text};
  const chosen=candidates[0];
  if(['count'].includes(dimension)&&!Number.isInteger(chosen.value))return null;
  return {value:clean(chosen.value),note:noteFrom(text,[chosen])};
}
