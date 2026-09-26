/** Required estimating model. Legacy host settings cannot silently change quality. */
export const ESTIMATOR_MODEL = 'gpt-4.1';
export const ESTIMATOR_MODEL_SNAPSHOT = 'gpt-4.1-2025-04-14';
export const MODEL_POLICY_VERSION = 'gpt-4.1-required-2026-09-26';

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
    provider: 'openai', model: ESTIMATOR_MODEL, policy: MODEL_POLICY_VERSION,
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
