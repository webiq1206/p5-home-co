import {priceReviewedScope,type EstimatorConfiguration} from './costBook.ts';
import {hasRestrictedScope} from './instructions.ts';
import {missingScopeFields,type MissingScopeField} from './missingFields.ts';
import type {ReviewedScope} from './scope.ts';

/** Quantities the deterministic planning model cannot work without are known
 * before any pricing call is made. Asking for them first costs the customer a
 * second; discovering them after inventory, mapping, allowances and the
 * coverage check cost minutes and then still ended in a question.
 *
 * A restricted scope ("price only the trim") is priced item by item rather
 * than from the planning model, so its quantities are resolved there. */
export function pricingPreflight(scope:ReviewedScope,configuration:EstimatorConfiguration,now=new Date()):MissingScopeField[]{
  if(hasRestrictedScope(scope.answers,scope.extraction?.instructions))return [];
  const base=priceReviewedScope(scope,configuration,now);
  const notes=(('missingInformation' in base.internal?base.internal.missingInformation:[])||[]).filter(note=>note.startsWith('Missing quantity:')||note.startsWith('Missing cost condition:'));
  return missingScopeFields(notes).filter(item=>!String(scope.answers[item.field]??'').trim());
}
export const PREFLIGHT_MESSAGE='One more detail is needed before I can prepare your estimate. Your project is saved.';
