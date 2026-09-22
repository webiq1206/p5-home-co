/**
 * Reasoning effort for OpenAI reasoning models (speed, owner request 2026-09-21).
 *
 * Every site runs document reading and pricing on P5_SCOPE_OPENAI_MODEL=gpt-5.6-sol, a reasoning
 * model, at its default effort; live, one page read took 60 to 120 s and a pricing stage minutes.
 * These are structured, schema-bound tasks (read a page into fields, map scope to book lines), so a
 * low effort keeps the same model and its knowledge while cutting the thinking time. The accuracy
 * check (the audit) keeps a medium effort. P5_OPENAI_REASONING_EFFORT overrides every stage
 * ("default" sends no setting). Non-reasoning models (gpt-4.1) receive nothing.
 */
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
