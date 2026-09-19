import {SCOPE_FIELDS,type ScopeField} from './scope.ts';

export interface MissingScopeField {field:ScopeField;label:string}

/** The scope field a missing-information note asks for, when it names one.
 * Cost-book and planning-book notes read "Missing quantity: <field>",
 * "Missing quantity: <field> for <work>" or "Missing cost condition: <field>
 * for <rule>"; anything after the field name is description. Notes that name
 * no field ("Missing cost rate: 03-01-01", "Missing quantity: specialist trade
 * takeoff ...") are estimator review items and are not offered as a link. */
export function missingNoteField(note:string):ScopeField|null{
  const match=/^Missing (?:quantity|cost condition): ([A-Za-z][A-Za-z0-9]*)(?:$|[\s.,;:])/.exec(note.trim());
  if(!match)return null;
  return match[1] in SCOPE_FIELDS?match[1] as ScopeField:null;
}

/** Fields the visitor can still answer to unblock pricing, in scope-field
 * vocabulary and in the order the questions are asked. */
export function missingScopeFields(missing:string[]):MissingScopeField[]{
  const wanted=new Set(missing.map(missingNoteField).filter((field):field is ScopeField=>Boolean(field)));
  return (Object.entries(SCOPE_FIELDS) as [ScopeField,{label:string}][])
    .filter(([key])=>wanted.has(key))
    .map(([field,definition])=>({field,label:definition.label}));
}

/** Pricing diagnostics belong in the staff record. Only explicit customer
 * questions cross the incomplete-estimate response boundary. */
export function customerPricingQuestions(missing:string[]):string[]{
 const questions=missing.flatMap(note=>note.match(/\b(?:Should|Will|What|Which|How|Who|Do|Does|Is|Are|Can)\b[^?]*\?/gi)||[])
  .filter(question=>!/(?:[$€£]|\b(?:direct[- ]cost|unit[- ]cost|markup|margin|divisor|payroll|catalog rate)\b)/i.test(question));
 return [...new Set(questions.map(question=>question.trim()))];
}
