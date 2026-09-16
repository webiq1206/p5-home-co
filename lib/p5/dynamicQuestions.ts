import {validateAnswer,type ScopeAnswers,type ScopeExtraction,type ScopeField} from './scope.ts';

/** Question selection only. This module never invents quantities or authorizes prices. */
const BUILDS = new Set(['new-construction', 'addition', 'adu']);
const REMODELS = new Set(['kitchen', 'bathroom', 'whole-home']);
const SMALL = new Set(['handyman', 're10', 'change-order', 'rush']);
const TOPICS = {
  flooring: /\b(?:flooring|lvp|lvt|hardwood|laminate|carpet)\b|\b(?:install|replace|refinish|sand|new|repair) (?:the )?floors?\b/i,
  tile: /\b(?:tile|tiling|backsplash)\b/i,
  demolition: /\b(?:demolition|demolish|tear[ -]?out|remove|removal)\b/i,
  trim: /\b(?:trim|baseboards?|crown moulding|crown molding)\b/i,
  base: /\b(?:base cabinets?|lower cabinets?|vanit(?:y|ies))\b/i,
  upper: /\b(?:upper cabinets?|wall cabinets?)\b/i,
  tall: /\b(?:tall cabinets?|pantry cabinets?|full.height cabinets?)\b/i,
  cabinets: /\b(?:cabinets?|cabinetry|vanit(?:y|ies))\b/i,
  countertops: /\b(?:countertops?|counters?|worktops?)\b/i,
  paint: /\b(?:paint|painting|repaint|drywall|plaster)\b/i,
  garage: /\bgarage\b/i,
  outdoor: /\b(?:covered (?:outdoor|patio|porch|deck)|covered outdoor space)\b/i,
  plumbing: /\b(?:plumbing|toilets?|faucets?|sinks?|showers?|water heater|disposal)\b/i,
  electrical: /\b(?:electrical|outlets?|switches?|lights?|lighting|gfci|panel|ceiling fan)\b/i,
  mechanical: /\b(?:hvac|heating|cooling|ventilation|furnace|air condition)\b/i,
  structural: /\b(?:structural|framing|foundation|load.bearing|beam|footing|slab)\b/i,
} as const;
type Topic = keyof typeof TOPICS;
const FIELD_TOPIC: Partial<Record<ScopeField, Topic>> = {
  flooringSqft: 'flooring', tileSqft: 'tile', demolitionSqft: 'demolition', trimLf: 'trim',
  cabinetBaseLf: 'base', cabinetUpperLf: 'upper', cabinetTallLf: 'tall', cabinetRoom: 'cabinets',
  cabinetConstruction: 'cabinets', garageIncluded: 'garage', garageSqft: 'garage',
  countertopSqft: 'countertops',
  coveredOutdoorSqft: 'outdoor', plumbing: 'plumbing', electrical: 'electrical',
  mechanical: 'mechanical', structural: 'structural',
};
const NEGATIVE = /\b(?:no|not|without|exclude[ds]?|excluding|retain|keep|reuse|unchanged|remain|existing .{0,20} stays?|do not|don't)\b/i;
const AREA_UNIT = /^(?:sf|sq\.?\s*ft|sqft|square\s*feet|ft2|ft²)$/i;
const LENGTH_UNIT = /^(?:lf|lin\.?\s*ft|linear\s*feet|ft|feet)$/i;
const COUNT_UNIT = /^(?:ea|each|unit|units|cabinet|cabinets|door|doors)$/i;
const clauses = (text: string): string[] => text.split(/\n|;|\.(?:\s|$)|\bbut\b/i).map(s => s.trim()).filter(Boolean);
const excludedClause = /^(?:please\s+)?(?:exclude\w*|no|without|do not|don't)\b/i;
const completedClause = /\b(?:has|have)\s+(?:already\s+)?been\s+completed\b|\b(?:is|was)\s+already\s+complete(?:d)?\b/i;
const positiveClauses = (text: string) => clauses(text)
  .filter(s => !excludedClause.test(s) && !completedClause.test(s))
  .flatMap(s => s.split(/,|\band\b/i)).filter(s => !NEGATIVE.test(s));
const joined = (values: (string | undefined)[]) => values.filter(Boolean).join('\n');

export interface QuestionContext {
  answers: ScopeAnswers;
  service: string;
  text: string;
  positive: string;
  restriction: string;
  exclusions: string[];
  takeoffs: NonNullable<ScopeExtraction['takeoffs']>;
  extraction: ScopeExtraction | null;
  fullProject: boolean;
  laborOnly: boolean;
}

export function questionContext(answers: ScopeAnswers, extraction: ScopeExtraction | null = null, sourceText = ''): QuestionContext {
  const service = answers.service || '';
  const directions = joined([answers.estimatingInstructions, ...(extraction?.instructions?.inclusions || [])]);
  const explicitDirections = joined([directions, sourceText, answers.taskList]);
  // A building/floor restriction is not a trade restriction. Material-only and labor-only
  // directions change responsibility, not which physical components belong to the project.
  const restrictive = clauses(explicitDirections).filter(s => /\bonly\b|limited to|restrict.*to/i.test(s)
    && !/^(?:labor|materials?|supply|installation)[ -]only[.!]?$/i.test(s.trim()));
  const restriction = restrictive.filter(s => Object.values(TOPICS).some(re => re.test(s))).join('\n');
  const statedScope = (extraction?.facts || []).filter(f => f.confidence >= .85 && f.value?.trim()
    && f.basis !== 'visual' && f.basis !== 'inferred'
    && ['taskList','otherDetails','demolition','structural','plumbing','electrical','mechanical','installation','materials','fixtures'].includes(f.field))
    .map(f => f.value).join('\n');
  const authored = joined([sourceText, statedScope, answers.taskList, answers.otherDetails,
    answers.demolition, answers.structural, answers.plumbing, answers.electrical,
    answers.mechanical, answers.installation, answers.materials, answers.fixtures]);
  const takeoffs = (extraction?.takeoffs || []).filter(t => {
    const building = extraction?.instructions?.buildings || [];
    const floors = extraction?.instructions?.floors || [];
    return (!building.length || !t.building || building.some(b => b.toLowerCase() === t.building.toLowerCase()))
      && (!floors.length || !t.floor || floors.some(f => f.toLowerCase() === t.floor.toLowerCase()));
  });
  const text = joined([authored, directions, ...takeoffs.map(t => `${t.component}: ${t.description}`)]);
  const exclusions = [...clauses(answers.exclusions || ''), ...(extraction?.instructions?.exclusions || []),
    ...clauses(authored).filter(s=>excludedClause.test(s))];
  // A general service label alone does not make every trade part of a repair request.
  const fullProject = !restriction && (BUILDS.has(service) || REMODELS.has(service) && !componentRemodel(authored,exclusions));
  return {answers, service, text, positive: positiveClauses(text).join('\n'), restriction,
    exclusions, takeoffs, extraction, fullProject,
    laborOnly: extraction?.instructions?.laborOnly === true || /\blabou?r[ -]only\b/i.test(directions)
      || clauses(joined([sourceText,answers.taskList,answers.installation])).some(clause=>/^(?:(?:price|estimate|quote|include|provide)\s+)?labou?r(?:\s+and\s+installation)?[ -]only\b(?!\s+(?:for|on)\b)/i.test(clause))};
}

/** A cabinet/countertop replacement with other room trades expressly excluded
 * does not become a complete room renovation because its service is "kitchen".
 * Keep area questions for broad renovations and any stated wall/ceiling work. */
function componentRemodel(text:string,exclusions:string[]):boolean {
 const positive=positiveClauses(text).join('\n');
 const negative=[...exclusions,...clauses(text).filter(s=>/\b(?:exclude\w*|no|not|without)\b/i.test(s))].join('\n');
 if(!TOPICS.cabinets.test(positive)&&!TOPICS.countertops.test(positive))return false;
 const excludedTrades=['flooring','plumbing','electrical','mechanical','structural'].filter(t=>TOPICS[t as Topic].test(negative));
 if(excludedTrades.length<2)return false;
 if(/\b(?:full|complete|whole|gut)\s+(?:kitchen|bathroom|home|renovation|remodel)|\b(?:walls?(?! cabinets?)|ceilings?|drywall|plaster)\b/i.test(positive))return false;
 return !(['flooring','tile','plumbing','electrical','mechanical','structural'] as Topic[]).some(t=>TOPICS[t].test(positive)&&!TOPICS[t].test(negative));
}

function excluded(context: QuestionContext, topic: Topic): boolean {
  const pattern = TOPICS[topic];
  const excludedTopic = context.exclusions.some(s => pattern.test(s)
    // Excluding purchase of a material is not excluding its installation.
    && !/\b(?:purchase|supply|material|owner.supplied)\b/i.test(s));
  if (excludedTopic) return true;
  if (context.restriction && !pattern.test(context.restriction)) {
    // Base/upper/tall are subdivisions of a genuinely requested cabinet package.
    if (['base', 'upper', 'tall'].includes(topic) && TOPICS.cabinets.test(context.restriction)) return false;
    return true;
  }
  return false;
}
function topicActive(context: QuestionContext, topic: Topic): boolean {
  if (excluded(context, topic)) return false;
  return TOPICS[topic].test(context.restriction || context.positive);
}
/** Painting measured trim or cabinet doors does not require whole-room area. */
function paintedAreaApplies(context: QuestionContext): boolean {
 if (!topicActive(context,'paint')) return false;
 const text=context.restriction||context.positive;
 if (/\b(?:walls?(?! cabinets?)|ceilings?|drywall|plaster|interior walls|exterior siding)\b/i.test(text)) return true;
 return !/\b(?:trim|baseboards?|moulding|molding|cabinets?|cabinetry|doors?|fence|gate|railings?)\b/i.test(text);
}
/** A specified cabinet package is more precise than a generic material tier. */
export function cabinetSelectionsSpecified(context: QuestionContext): boolean {
 if(!context.service.startsWith('cabinet-'))return false;
 const specified=[...positiveClauses(context.text),context.answers.materials,context.answers.cabinetConstruction,
 ...(context.extraction?.facts||[]).filter(f=>['materials','cabinetConstruction'].includes(f.field)
 &&Number.isFinite(f.confidence)&&f.confidence>=.85&&f.basis!=='visual'&&f.basis!=='inferred').map(f=>f.value)].filter(Boolean).join('\n');
 return /\b(?:plywood|mdf|melamine|particleboard|solid wood|oak|maple|walnut|shaker|slab doors?|raised[ -]panel)\b/i.test(specified)
 && /\b(?:painted|stained|laminate|thermofoil|unfinished|natural finish)\b/i.test(specified);
}
function cabinetPackage(context: QuestionContext): boolean {
  if (!topicActive(context, 'cabinets') && !context.service.startsWith('cabinet-')) return false;
  // Knobs, hinges and painting existing cabinets are not new cabinet runs.
  const text = context.restriction || context.positive;
  return !(/\b(?:knobs?|pulls?|hinges?|handles?|paint|refinish)\b/i.test(text)
    && !/\b(?:new cabinets?|replace (?:the )?cabinets?|supply cabinets?|install cabinets?|cabinet replacement)\b/i.test(text));
}
function numericTakeoff(t: QuestionContext['takeoffs'][number]): boolean {
  return typeof t.quantity === 'number' && Number.isFinite(t.quantity) && t.quantity > 0
    && (t.basis === 'stated' || t.basis === 'calculated') && !t.issues.length;
}
/** Every relevant row must be supported. One measured room never covers an unmeasured second room. */
function measuredTopic(context: QuestionContext, topic: Topic): boolean {
  const items = context.takeoffs.filter(t => TOPICS[topic].test(`${t.component} ${t.description}`));
  if (!items.length) return false;
  return items.every(t => numericTakeoff(t) && (topic === 'trim' ? LENGTH_UNIT.test(t.unit)
    : ['base', 'upper', 'tall', 'cabinets'].includes(topic) ? LENGTH_UNIT.test(t.unit) || COUNT_UNIT.test(t.unit)
    : AREA_UNIT.test(t.unit)));
}
function validQuestionValue(field:ScopeField,value:string|undefined):boolean {
  if(!value?.trim()||validateAnswer(field,value))return false;
  return !['sqft','length','width','rooms','stories'].includes(field)||Number(value.replaceAll(',',''))>0;
}
function sourceAnswered(context: QuestionContext, field: ScopeField): boolean {
  // Validated visitor corrections win. Source-only facts must be valid and
  // agree before they can suppress a required question.
  if (validQuestionValue(field,context.answers[field])) return true;
  if (context.extraction?.conflicts.some(c => c.field === field)) return false;
  const facts=(context.extraction?.facts||[]).filter(f => f.field === field
    && Number.isFinite(f.confidence) && f.confidence >= .85
    && validQuestionValue(field,f.value) && f.basis !== 'visual' && f.basis !== 'inferred');
  const normalize=(value:string)=>{
    const numeric=Number(value.replaceAll(',',''));
    return Number.isFinite(numeric)?String(numeric):value.trim().toLowerCase();
  };
  return facts.length>0 && new Set(facts.map(f=>normalize(f.value))).size===1;
}

/** Applicability is separate from whether a question is already answered, so real conflicts survive. */
export function scopeFieldApplies(field: ScopeField, context: QuestionContext): boolean {
  const topic = FIELD_TOPIC[field];
  if (topic && excluded(context, topic)) return false;
  if (field === 'service' || field === 'taskList' || field === 'estimatingInstructions') return true;
  if (field === 'address') return false;
  if (!context.service) return true;
  if (field === 'finish') return !context.laborOnly && !context.restriction && !cabinetSelectionsSpecified(context)
    && (context.fullProject || context.service.startsWith('cabinet-'));
  if (field === 'garageIncluded') return context.service === 'new-construction' && !context.restriction
    || topicActive(context, 'garage');
  if (field === 'garageSqft') return context.answers.garageIncluded !== 'no'
    && (context.answers.garageIncluded === 'yes' || topicActive(context, 'garage'));
  if (field === 'cabinetRoom') return context.service.startsWith('cabinet-') && cabinetPackage(context);
  if (field === 'demolitionSqft') return topicActive(context, 'demolition')
    && /\b(?:walls?|floors?|flooring|ceilings?|tile|rooms?|drywall|slabs?|house|home)\b/i.test(context.restriction || context.positive);
  if (['cabinetBaseLf', 'cabinetUpperLf', 'cabinetTallLf', 'cabinetConstruction'].includes(field)) {
    if (!cabinetPackage(context)) return false;
    if (field === 'cabinetBaseLf') return topicActive(context, 'base')
      || context.service.startsWith('cabinet-') && !topicActive(context, 'upper') && !topicActive(context, 'tall');
    if (field === 'cabinetUpperLf') return topicActive(context, 'upper');
    if (field === 'cabinetTallLf') return topicActive(context, 'tall');
    return true;
  }
  if (field === 'sqft') return !context.restriction && (context.fullProject || paintedAreaApplies(context));
  if (field === 'rooms' || field === 'bathrooms' || field === 'stories') return context.fullProject;
  if (field === 'laborHours') return /\b(?:time and materials|hourly|labor hours|labour hours)\b/i.test(context.positive);
  // This field is requested only by a priced assembly or a source question.
  // Keep that dependency unless countertops are explicitly outside the scope.
  if (field === 'countertopSqft') return true;
  if (topic) return topicActive(context, topic) || context.fullProject && ['flooringSqft','tileSqft','trimLf'].includes(field);
  return true;
}

/** Build the minimum current queue from requested work, source evidence and actual cost-book dependencies. */
export function dynamicScopeFields(answers: ScopeAnswers, extraction: ScopeExtraction | null = null,
  pricedFields: ScopeField[] = [], sourceText = ''): ScopeField[] {
  const context = questionContext(answers, extraction, sourceText);
  if (!answers.service) return ['service'];
  const fields = new Set<ScopeField>();
  const hasWork = Boolean(joined([sourceText, answers.taskList, answers.otherDetails, answers.demolition,
    answers.structural, answers.plumbing, answers.electrical, answers.installation]).trim()
    || extraction?.takeoffs?.length || extraction?.instructions?.inclusions?.length
    || answers.service?.startsWith('cabinet-') && [answers.cabinetBaseLf,answers.cabinetUpperLf,answers.cabinetTallLf].some(v=>v?.trim()));
  if (!hasWork) fields.add('taskList');
  if (scopeFieldApplies('sqft', context)) fields.add('sqft');
  if (scopeFieldApplies('garageIncluded', context)) fields.add('garageIncluded');
  if (scopeFieldApplies('garageSqft', context)) fields.add('garageSqft');
  if (scopeFieldApplies('finish', context) && !sourceAnswered(context,'materials')) fields.add('finish');
  if (scopeFieldApplies('cabinetRoom', context) && !/\b(?:kitchen|bathroom|laundry|mudroom|pantry|office)\b/i.test(context.positive)) fields.add('cabinetRoom');
  for (const field of ['flooringSqft', 'tileSqft', 'demolitionSqft', 'trimLf', 'cabinetBaseLf', 'cabinetUpperLf', 'cabinetTallLf', 'coveredOutdoorSqft'] as ScopeField[]) {
    if (scopeFieldApplies(field, context)) fields.add(field);
  }
  // A complete whole-project assembly can use documented quantity allowances;
  // do not turn every unspecified trade measurement into a homeowner questionnaire.
  if (context.fullProject) {
    for (const field of ['flooringSqft', 'tileSqft', 'demolitionSqft', 'trimLf', 'cabinetBaseLf', 'cabinetUpperLf', 'cabinetTallLf'] as ScopeField[]) fields.delete(field);
  }
  for (const field of pricedFields) if (scopeFieldApplies(field, context)) fields.add(field);
  for (const clarification of extraction?.clarifications || []) {
    const field = clarification.field;
    const optional = ['location','address','schedule','urgency','projectMonths','phasing'].includes(field);
    const numeric = ['fixtureCount','rooms','stories','bathrooms','laborHours','countertopSqft','length','width','sqft','flooringSqft','tileSqft','demolitionSqft','trimLf','cabinetBaseLf','cabinetUpperLf','cabinetTallLf','garageSqft','coveredOutdoorSqft'].includes(field);
    if (optional && !pricedFields.includes(field)) continue;
    if (numeric && !pricedFields.includes(field) && !fields.has(field)) continue;
    if (scopeFieldApplies(field, context)) fields.add(field);
  }
  // Unknown production hours are an estimator's calculation. Ask about the
  // actual work, not a contractor-only labor budget the customer cannot know.
  if (SMALL.has(context.service) && !hasWork) fields.add('taskList');
  return [...fields].filter(field => {
    if (!scopeFieldApplies(field, context) || sourceAnswered(context, field)) return false;
    if (field === 'finish' && (answers.materials?.trim() || sourceAnswered(context, 'materials'))) return false;
    const topic = FIELD_TOPIC[field];
    if (topic && measuredTopic(context, topic) && field !== 'garageIncluded') return false;
    if (field === 'taskList' && hasWork) return false;
    return true;
  });
}

/** Remove only questions demonstrably answered or outside the selected scope. Unknown
 * specialist decisions stay visible rather than being silently treated as resolved. */
export function scopePromptApplies(field: ScopeField | undefined, question: string, context: QuestionContext): boolean {
  // A pending source decision must not disappear merely because it has no answer.
  if (field === 'address') return false;
  const topic = field ? FIELD_TOPIC[field] : undefined;
  if (topic && excluded(context, topic)) return false;
  if (field && ['finish','sqft','rooms','bathrooms','stories'].includes(field) && !scopeFieldApplies(field, context)) return false;
  if (field === 'garageSqft' && context.answers.garageIncluded === 'no') return false;
  if (field === 'cabinetRoom' && context.service && !context.service.startsWith('cabinet-')) return false;
  if (field && sourceAnswered(context, field) && !context.extraction?.conflicts.some(c => c.field === field)) return false;
  const topics = (Object.keys(TOPICS) as Topic[]).filter(topic => TOPICS[topic].test(question));
  if (topics.length && topics.every(topic => excluded(context, topic))) return false;
  if (context.laborOnly && /\b(?:finish level|finish tier|material grade|material selection)\b/i.test(question)) return false;
  return true;
}
