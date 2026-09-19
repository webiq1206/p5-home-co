/** Display labels are written by the person answering, not by the contractor.
 * Canonical option values remain unchanged for existing deterministic rules. */
export function customerChoiceLabel(value:string){
  const labels:Record<string,string>={
    'Owner handles installation':"I'll arrange installation",
    'Include installation in this estimate':'Please include installation',
    'Labor only':'Please include labor only',
    'Materials only':'Please include materials only',
    'Labor and materials':'Please include labor and materials',
    'Include it':'Please include it',
    'Exclude it':'Please leave it out',
  };
  return labels[value]||value;
}
/** Preserve custom text on chip clicks; never silently replace a typed answer. */
export function selectCustomerAnswer(choice:string,draft:string,optionLabels:readonly string[]){
  const text=draft.trim();
  if(!text||optionLabels.includes(text)||text===choice)return choice;
  if(text.startsWith(choice+'\n'))return text;
  const prior=optionLabels.find(label=>text.startsWith(label+'\n'));
  return `${choice}\n${prior?text.slice(prior.length).trim():text}`;
}
export function contextualCustomerAnswer(question:string,answer:string){
  return `Question: ${question.trim()}\nMy answer: ${answer.trim()}`;
}
/** A preset is canonical only when it is the entire answer. Extra detail,
 * uncertainty and negation need interpretation together with the question. */
export function exactCustomerChoice(answer:string,values:readonly string[],label:(value:string)=>string=(value)=>value){
  const text=answer.trim().toLowerCase();
  return values.find(value=>value.toLowerCase()===text||label(value).toLowerCase()===text)||null;
}
export function customerQuestionKey(question:{instructionId?:string;field:string;reason:string}|null){
  return question?(question.instructionId||JSON.stringify([question.field,question.reason])):undefined;
}
