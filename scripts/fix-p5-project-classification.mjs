import fs from 'node:fs';
const file='lib/p5/extraction.ts';
const original='A broad document can contain trades outside this company. Preserve its relevant specifications, but select service only for the requested work that this company offers; if the requested subset is unclear, leave service absent and ask one short service clarification with field=service. Never put service-fit or company-eligibility questions in instructions.questions. Never treat an entire new home as a cabinet or repair-only estimate.';
const replacement='PROJECT CLASSIFICATION BEFORE BRAND ROUTING: Classify the actual requested work using the complete service field vocabulary, even when this website does not offer that service. Preserve the correct service so the application can route it to the matching P5 company. Never force a new build into a remodel, cabinet or repair category because of this website brand. The requested subset controls: a cabinet-only request inside a full new-build plan set remains cabinet work. An explicit project type in previousAnswers or the submitted scope must not be asked again unless a genuine, evidence-backed contradiction changes the requested work. Mentions inside exclusions, negated alternatives, or descriptions of existing conditions are not competing project types. If the requested work is genuinely ambiguous, leave service absent and ask one short field=service question identifying that exact ambiguity. Never put service-fit or company-eligibility questions in instructions.questions.';
let source=fs.readFileSync(file,'utf8');
if(!source.includes(replacement)){
 if(!source.includes(original))throw new Error('Inspect changed project classification instructions before applying this repair.');
 source=source.replace(original,replacement);
}
const marker='Ask only financially significant follow-up questions missing from BOTH previous answers and supplied sources.';
const policy=marker+' QUESTION NECESSITY: Each clarification must concern currently included work, identify an actual unanswered quantity, specification, responsibility or scope conflict, and state how the answer affects this project price. Do not generate a checklist from the service name. Do not ask for a value already supplied in previousAnswers, typed scope, schedules, specifications or any reviewed page. Use new-build finish language for new construction, additions and ADUs, never the remodel-only simple refresh option. Missing internal rates, provider failures and unpublished supplier quotes are pricing-system work, not missing customer facts. Do not ask a homeowner to calculate contractor labor hours unless the request is explicitly for an hourly allowance. Do not invent facts or prices to avoid a necessary question.';
if(!source.includes('QUESTION NECESSITY:')){
 if(!source.includes(marker))throw new Error('Inspect changed follow-up instruction boundary.');
 source=source.replace(marker,policy);
}
fs.writeFileSync(file,source);
const adaptive='lib/p5/adaptive.ts';let code=fs.readFileSync(adaptive,'utf8');
const stale="  if(['new-construction','addition','adu'].includes(answers.service||'')&&answers.finish==='refresh')delete answers.finish;";
if(!code.includes(stale)){
 const start='export function deriveScopeAnswers(input:ScopeAnswers){\n  const answers={...input};';
 if(!code.includes(start))throw new Error('Inspect changed answer derivation boundary.');
 code=code.replace(start,start+'\n  // A previous remodel answer cannot become the finish selection for a new build.\n'+stale);
 fs.writeFileSync(adaptive,code);
}
const tests='tests/p5-question-context.test.ts';let suite=fs.readFileSync(tests,'utf8');
if(!suite.includes('classification: source service survives an unsupported website brand')){
 suite+=`

test('classification: source service survives an unsupported website brand',async()=>{
 const {EXTRACTION_SYSTEM}=await import('../lib/p5/extraction.ts');
 assert.match(EXTRACTION_SYSTEM,/Classify the actual requested work using the complete service field vocabulary/);
 assert.doesNotMatch(EXTRACTION_SYSTEM,/select service only for the requested work that this company offers/);
 assert.match(EXTRACTION_SYSTEM,/requested subset controls/);
 assert.match(EXTRACTION_SYSTEM,/exclusions, negated alternatives/);
});
test('classification: follow-ups require a real project-specific pricing gap',async()=>{
 const {EXTRACTION_SYSTEM}=await import('../lib/p5/extraction.ts');
 assert.match(EXTRACTION_SYSTEM,/QUESTION NECESSITY:/);
 assert.match(EXTRACTION_SYSTEM,/Do not generate a checklist from the service name/);
 assert.match(EXTRACTION_SYSTEM,/not missing customer facts/);
});
test('classification: stale remodel refresh answers are replaced with build-appropriate choices',async()=>{
 const {deriveScopeAnswers}=await import('../lib/p5/adaptive.ts');
 const previous={...build,finish:'refresh'};
 assert.equal(deriveScopeAnswers(previous).finish,undefined);
 const q=scopeQuestions(previous,null);
 assert.equal(q.length,1);assert.equal(q[0].field,'finish');
 assert.ok(!q[0].values?.includes('refresh'));
 assert.equal(previous.finish,'refresh','the source snapshot remains unchanged');
});
`;
 fs.writeFileSync(tests,suite);
}
console.log('Classify the requested work before brand routing; require relevant missing-price questions and invalidate stale remodel finish answers.');
