/** Keep the input screen open, but recompute later steps from current questions. */
export function resumeWizardDraft<T extends {step:number}>(draft:T,hasQuestions:boolean):T {
  const step=draft.step===0?0:hasQuestions?1:2;
  return step===draft.step?draft:{...draft,step};
}
