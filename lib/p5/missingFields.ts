import {SCOPE_FIELDS,type ScopeField} from './scope.ts';

export interface MissingScopeField {field:ScopeField;label:string}

/** Fields the visitor can still answer to unblock pricing, in scope-field vocabulary.
 * Only cost-book quantity and condition gaps are answerable questions; other
 * missing information is an estimator review item and is not offered as a link. */
export function missingScopeFields(missing:string[]):MissingScopeField[]{
  return (Object.entries(SCOPE_FIELDS) as [ScopeField,{label:string}][])
    .filter(([key])=>missing.some(item=>item.startsWith(`Missing quantity: ${key} `)||item.startsWith(`Missing cost condition: ${key} `)))
    .map(([field,definition])=>({field,label:definition.label}));
}
