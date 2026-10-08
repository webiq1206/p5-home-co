import {ESTIMATOR_BRAND} from './brand.ts';
/** Required estimating model. Legacy host settings cannot silently change quality. The
 * provider default is brand-owned: each site keeps the provider its secrets are configured for
 * unless P5_ESTIMATOR_PROVIDER names one explicitly. */
const brandProvider=(ESTIMATOR_BRAND as {estimatorProvider?:string}).estimatorProvider;
export const ESTIMATOR_PROVIDER = process.env.P5_ESTIMATOR_PROVIDER === 'openai' ? 'openai' : process.env.P5_ESTIMATOR_PROVIDER === 'anthropic' ? 'anthropic' : brandProvider === 'openai' ? 'openai' : 'anthropic';
export const ESTIMATOR_MODEL = ESTIMATOR_PROVIDER === 'openai' ? 'gpt-4.1' : 'claude-haiku-4-5-20251001';
export const ESTIMATOR_MODEL_SNAPSHOT = ESTIMATOR_PROVIDER === 'openai' ? 'gpt-4.1-2025-04-14' : 'claude-haiku-4-5-20251001';
// Saved reads must also meet the current visual source-evidence policy. The
// required model and accepted snapshot do not change when this policy advances.
export const MODEL_POLICY_VERSION = ESTIMATOR_PROVIDER === 'openai' ? 'gpt-4.1-required-form-evidence-2026-09-30' : 'haiku-4.5-required-form-evidence-2026-10-01';

export class EstimatorModelError extends Error {
  readonly code: 'estimator-model-unverified' | 'estimator-model-mismatch';
  constructor(code: 'estimator-model-unverified' | 'estimator-model-mismatch') {
    super(code);
    this.name = 'EstimatorModelError';
    this.code = code;
  }
}

/** Never substitute the requested model when a gateway omits the returned identity. */
export function assertEstimatorModel(returned: unknown): string {
  if (typeof returned !== 'string' || !returned.trim()) throw new EstimatorModelError('estimator-model-unverified');
  if (returned !== ESTIMATOR_MODEL && returned !== ESTIMATOR_MODEL_SNAPSHOT) throw new EstimatorModelError('estimator-model-mismatch');
  return returned;
}

export function estimatorModelConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const legacy = ['P5_SCOPE_OPENAI_MODEL', 'AI_INTEGRATIONS_OPENAI_MODEL', 'P5_READ_FAST_MODEL', 'P5_READ_DRAWING_MODEL', 'P5_MAP_MODEL', 'P5_PRICING_OPENAI_MODEL', 'P5_SHORTLIST_MODEL'];
  return {
    provider: ESTIMATOR_PROVIDER, model: ESTIMATOR_MODEL, policy: MODEL_POLICY_VERSION,
    source: 'required-estimator-policy',
    overriddenSettings: legacy.filter(key => Boolean(env[key]) && env[key] !== ESTIMATOR_MODEL),
    fallback: false,
  };
}

/** A historical requested model string alone was not verified response evidence. */
export function hasVerifiedAnalysis(value:unknown):boolean {
 const result=value as {modelPolicy?:string;model?:string}|null;
 if(result?.modelPolicy!==MODEL_POLICY_VERSION||typeof result.model!=='string')return false;
 try{return result.model.split(' + ').every(model=>Boolean(assertEstimatorModel(model)));}catch{return false;}
}
