/** Candidate wire compatibility and legacy benchmark effort. Production OpenAI
 * estimation remains GPT-4.1 and receives no reasoning-effort setting. */
export type ReasoningTask='read'|'inventory'|'map'|'research'|'audit';
export const isReasoningModel=(model:string)=>/^(?:gpt-[56]|o[1-9])/i.test(model.trim());
export function reasoningFor(model:string,task:ReasoningTask):{reasoning?:{effort:string}}{
  // Candidate wire compatibility only: production model selection stays unchanged.
  if(model==='gpt-6-luna'||model==='gpt-6-sol')return {reasoning:{effort:'none'}};
  if(/^gpt-6/i.test(model))throw new Error('reasoning-none-model-unqualified');
  if(!isReasoningModel(model))return {};
  const configured=(process.env.P5_OPENAI_REASONING_EFFORT||'').trim().toLowerCase();
  if(configured==='default')return {};
  const effort=configured||(task==='audit'?'medium':'low');
  return {reasoning:{effort}};
}
/** Recognize the gateway error without deciding that removing the setting is safe. */
export const rejectsReasoning=(status:number,detail:string)=>status===400&&/reasoning/i.test(detail);

/** Required none is a budget contract. Never remove it and accept a gateway default. */
export function mayRetryWithoutReasoning(status:number,detail:string,request:{reasoning?:{effort?:string}}):boolean {
 return Boolean(request.reasoning&&request.reasoning.effort!=='none'&&rejectsReasoning(status,detail));
}
