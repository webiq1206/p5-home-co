/** Legacy benchmark reasoning settings. Production estimation uses full GPT-4.1,
 * which receives no reasoning-effort setting. */
export type ReasoningTask='read'|'inventory'|'map'|'research'|'audit';
export const isReasoningModel=(model:string)=>/^(?:gpt-5|o[1-9])/i.test(model.trim());
export function reasoningFor(model:string,task:ReasoningTask):{reasoning?:{effort:string}}{
  if(!isReasoningModel(model))return {};
  const configured=(process.env.P5_OPENAI_REASONING_EFFORT||'').trim().toLowerCase();
  if(configured==='default')return {};
  const effort=configured||(task==='audit'?'medium':'low');
  return {reasoning:{effort}};
}
/** A provider that does not accept the setting answers 400 naming it; the request is then sent once without it. */
export const rejectsReasoning=(status:number,detail:string)=>status===400&&/reasoning/i.test(detail);
