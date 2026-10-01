import type {ScopeAnswers,ScopeConflict,ScopeExtraction,ScopeField} from './scope.ts';

/** Quantities belong to saved fields, so an answer never needs a second AI pass. */
export function cabinetQuestionField(text:string):ScopeField|undefined{
 if(!/\bcabinet\w*\b/i.test(text))return;
 if(/\b(?:lengths?|measurements?|dimensions?|linear|LF)\b/i.test(text)){
  if(/\b(?:base|lower)\b/i.test(text))return 'cabinetBaseLf';
  if(/\b(?:upper|wall)\b/i.test(text))return 'cabinetUpperLf';
  if(/\btall\b/i.test(text))return 'cabinetTallLf';
 }
 if(/\brooms?\b/i.test(text))return 'cabinetRoom';
}
/** Document segments sometimes ask for the same project area another segment
 * already supplied. Only a clearly project-wide question binds to sqft;
 * component measurements must remain separate questions. */
export function projectAreaQuestionField(text:string,answers:ScopeAnswers):ScopeField|undefined{
 // Separating living area from garage/outdoor area clarifies the quantity;
 // those exclusions must not turn the same living-area question into a new decision.
 text=text.replace(/\([^)]*\bexclud(?:e|es|ing)\b[^)]*\)/gi,'').replace(/\bexcluding\b.*$/i,'');
 if(!/\b(?:square (?:feet|footage)|sq\.?\s*ft|area)\b/i.test(text)||!/\b(?:total|overall|entire|whole|project|ADU)\b/i.test(text))return;
 if(/\b(?:garage|outdoor|covered|roof|wall|flooring|tile|countertop|window|door|foundation|existing)\b/i.test(text))return;
 const subject:Record<string,RegExp>={addition:/\baddition\b/i,adu:/\badu\b/i,'new-construction':/\b(?:home|house|residence|living space)\b/i,'whole-home':/\b(?:home|house|residence|project)\b/i,kitchen:/\bkitchen\b/i,bathroom:/\bbathroom\b/i};
 if(/\bproject\b/i.test(text)||subject[answers.service||'']?.test(text))return 'sqft';
}

/** Bind ordinary project questions to their actual saved answer. Component
 * quantities remain distinct; this is not fuzzy text deduplication. */
export function projectQuestionField(text:string,answers:ScopeAnswers):ScopeField|undefined{
 if(/\b(?:concrete|driveway|slab|patio)\b/i.test(text)&&/\b(?:broom|smooth|stamped|exposed aggregate|trowel)\b/i.test(text))return 'materials';
 if(/\b(?:shower|wall)\b/i.test(text)&&!/\bfloor\b/i.test(text)&&/\btile\b/i.test(text)&&/\b(?:area|square feet|square footage|SF)\b/i.test(text))return 'wallTileSqft';
 if(/\bfloor(?:ing)?\b/i.test(text)&&/\b(?:area|square feet|square footage|SF)\b/i.test(text))return 'flooringSqft';
 if(/\b(?:shower|backsplash)\b/i.test(text)&&/\b(?:area|square feet|square footage|SF)\b/i.test(text))return 'tileSqft';
 const measured=/\b(?:how many|number of|count|total)\b/i;
 if(/\b(?:stories|story|levels)\b/i.test(text)&&/\b(?:how many|number of|single|multiple|one|two)\b/i.test(text))return 'stories';
 if(measured.test(text)&&/\b(?:GFCI|receptacles?|passage (?:door )?(?:handles?|levers?))\b/i.test(text)&&! /\b(?:toilets?|sinks?|faucets?)\b/i.test(text))return 'fixtureCount';
 if(/\b(?:which|what)\b/i.test(text)&&!/\bappliances?\b/i.test(text)&&/\bfixtures?\b/i.test(text)&&/\b(?:replac\w*|include\w*)\b/i.test(text))return 'fixtures';
 if(/\b(?:finish|type)\b/i.test(text)&&/\b(?:select\w*|allowance)\b/i.test(text)&&! /\b(?:fire|waterproof|rating|capacity)\b/i.test(text))return 'materials';
 if(measured.test(text)&&/\bbathrooms?\b/i.test(text)&&!/\b(?:fixtures?|sinks?|toilets?|vanit|area|square)\b/i.test(text))return 'bathrooms';
 if(measured.test(text)&&/\brooms?\b/i.test(text)&&!/\bcabinets?\b/i.test(text))return 'rooms';
 if(/\bfinish (?:level|tier)\b/i.test(text))return 'finish';
 if(/\bgarage\b/i.test(text)&&['new-construction','adu','addition'].includes(answers.service||'')&&!/\b(?:water heater|outlet|door opener)\b/i.test(text)){
  if(/\b(?:area|square feet|square footage|sqft)\b/i.test(text)&&!/\b(?:will|does|is|include|included|should)\b[^?]*\?\s*if so/i.test(text))return 'garageSqft';
  if(/\b(?:will|does|is|include|included|should)\b/i.test(text))return 'garageIncluded';
 }
 if(/\b(?:utilit(?:y|ies)|water|sewer|electric(?:al)?|gas)\b/i.test(text)&&/\b(?:connect|connection|extension|distance|length|available|availability|stub|runs?)\w*\b/i.test(text))return 'utilities';
 if(/\b(?:utility|utilities)\s*\/\s*site\b|\bsite\s*\/\s*(?:utility|utilities)\b/i.test(text)&&/\b(?:missing|special|requirements|details)\b/i.test(text))return 'site';
 if(/\b(?:soils?|slope|site conditions|grading|site access)\b/i.test(text))return 'site';
 if(/\b(?:what|which)\b[^?]*\b(?:work|changes|repairs)\b[^?]*\b(?:want|proposed|include|need|done)\w*\b/i.test(text))return 'taskList';
 return projectAreaQuestionField(text,answers);
}

/** Separate independent requests without splitting a list of answer choices. */
export function atomicInstructionQuestions(text:string,answers:ScopeAnswers={},conflicts:ScopeConflict[]=[]):string[]{
 if(/\bfloor\b/i.test(text)&&/\bshower\b/i.test(text)&&/\b(?:tile|area|square feet|SF)\b/i.test(text))return [
  ...(!answers.flooringSqft?['How many square feet of bathroom floor tile are included?']:[]),
  ...(!answers.wallTileSqft?['How many square feet of shower wall tile are included?']:[]),
 ];
 // "linear feet for the base, upper and tall cabinets" puts the unit before
 // the components. Each answer needs its own numeric control.
 if(/\bcabinet\w*\b/i.test(text)&&/\b(?:linear feet|linear footage|lengths?|LF)\b/i.test(text)){
  const named=[['base|lower','cabinetBaseLf','base'],['upper|wall','cabinetUpperLf','wall'],['tall','cabinetTallLf','tall']] as const;
  const found=named.filter(([pattern])=>new RegExp('\\b(?:'+pattern+')\\b','i').test(text));
  if(found.length>1)text+=' '+found.map(([,field,label])=>`${field==='cabinetBaseLf'?'base':label} cabinet linear feet`).join(', ');
 }
 if(/\bcabinet\w*\s+(?:run\s+)?(?:lengths?|measurements?|dimensions?)\b/i.test(text)&&!/\b(?:base|lower|upper|wall|tall)\b/i.test(text))text=text.replace(/\bcabinet\w*\s+(?:run\s+)?(?:lengths?|measurements?|dimensions?)\b/i,'base cabinet linear feet, upper cabinet linear feet, tall cabinet linear feet');
 const topics:{pattern:RegExp;question:string;field?:ScopeField}[]=[
  {pattern:/\bbase\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of base cabinets are included?',field:'cabinetBaseLf'},
  {pattern:/\b(?:upper|wall)\s+cabinet\w*\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of wall cabinets are included?',field:'cabinetUpperLf'},
  {pattern:/\btall\s+cabinet\w*\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of tall cabinets are included?',field:'cabinetTallLf'},
  {pattern:/\broom(?:\(s\)|s)?\b/i,question:'Which rooms are the cabinets for?',field:'cabinetRoom'},
  {pattern:/\b(?:chosen|choose|select(?:ed)?|option|material)\b[\s\S]*\b(?:bench\s*top|counter\s*top)\b|\b(?:bench\s*top|counter\s*top)\b[\s\S]*\b(?:option|material|selection)\b/i,question:'Which bench top option would you like?'},
 ];
 const found=topics.filter(topic=>topic.pattern.test(text));
 if(found.length<2||!/\bcabinet\w*\b/i.test(text))return [text];
 return found.filter(topic=>!topic.field||!answers[topic.field]?.trim()||conflicts.some(c=>c.field===topic.field)).map(topic=>topic.question);
}
/** Only offer material names actually present in the retained scope. */
export function textBenchTopChoices(extraction:ScopeExtraction|null,question:string):string[]|undefined{
 if(!extraction||!/\b(?:bench[- ]?top|counter[- ]?top)\b/i.test(question))return;
 const rows=extraction.takeoffs||[];
 if(rows.length){
  const alternatives=rows.filter(item=>('alternativeGroup' in item&&item.alternativeGroup)||/\b(?:alternate|alternative|option|selection required)\b/i.test([item.description,...item.issues].join(' ')));
  if(!alternatives.length||alternatives.some(item=>!/\b(?:bench\s*top|counter\s*top|work\s*top)\b/i.test(item.description+' '+item.component)))return;
 }
 const choices=[
  {label:'Butcher block',pattern:/\bbutcher\s+block\b/i},
  {label:'Matching painted MDF/wood',pattern:/\b(?:matching\s+)?painted\s+(?:mdf(?:\s*\/\s*wood)?|wood(?:\s*\/\s*mdf)?)\b/i},
  {label:'Laminate',pattern:/\blaminate\b/i},
  {label:'Quartz',pattern:/\bquartz\b/i},
 ];
 const retained=JSON.stringify([extraction.summary,extraction.facts,extraction.instructions,extraction.takeoffs,question]);
 const excluded=(extraction.instructions?.exclusions||[]).join('\n');
 const values=choices.filter(choice=>choice.pattern.test(retained)&&!choice.pattern.test(excluded)).map(choice=>choice.label);
 return values.length>=2?values:undefined;
}
