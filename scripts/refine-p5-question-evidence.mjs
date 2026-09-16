import fs from 'node:fs';
const edit=(file,fn)=>{const before=fs.readFileSync(file,'utf8');const after=fn(before);if(before!==after)fs.writeFileSync(file,after);};
const swap=(source,from,to)=>{if(source.includes(to))return source;if(!source.includes(from))throw new Error(`Unrecognized source integration point: ${from.slice(0,90)}`);return source.replace(from,to);};
edit('lib/p5/dynamicQuestions.ts',s=>{
 s=swap(s,"  const authored = joined([sourceText, answers.taskList, answers.otherDetails,",`  const statedScope = (extraction?.facts || []).filter(f => f.confidence >= .85 && f.value?.trim()
    && f.basis !== 'visual' && f.basis !== 'inferred'
    && ['taskList','otherDetails','demolition','structural','plumbing','electrical','mechanical','installation','materials','fixtures'].includes(f.field))
    .map(f => f.value).join('\\n');
  const authored = joined([sourceText, statedScope, answers.taskList, answers.otherDetails,`);
 const start=s.indexOf('  const fullProject = !restriction && (BUILDS.has(service)');
 const end=s.indexOf('  return {answers, service, text,',start);
 const full="  const fullProject = !restriction && (BUILDS.has(service) || REMODELS.has(service));\n";
 if(!s.includes(full)){if(start<0||end<0)throw new Error('Full-project scope boundary missing');s=s.slice(0,start)+full+s.slice(end);}
 s=swap(s,"  if (field === 'address') return false;","  if (field === 'address') return false;\n  if (!context.service) return true;");
 s=swap(s,"  if (topic) return topicActive(context, topic);","  if (topic) return topicActive(context, topic) || context.fullProject && ['flooringSqft','tileSqft','trimLf'].includes(field);");
 s=swap(s,"    || extraction?.takeoffs?.length || extraction?.instructions?.inclusions?.length);","    || extraction?.takeoffs?.length || extraction?.instructions?.inclusions?.length\n    || answers.service?.startsWith('cabinet-') && [answers.cabinetBaseLf,answers.cabinetUpperLf,answers.cabinetTallLf].some(v=>v?.trim()));");
 s=swap(s,"  if (context.fullProject && sourceAnswered(context, 'sqft')) {","  if (context.fullProject) {");
 s=swap(s,"    if (scopeFieldApplies(clarification.field, context)) fields.add(clarification.field);",`    const field = clarification.field;
    const optional = ['location','address','schedule','urgency','projectMonths','phasing'].includes(field);
    const numeric = ['fixtureCount','rooms','stories','bathrooms','laborHours','countertopSqft','length','width','sqft','flooringSqft','tileSqft','demolitionSqft','trimLf','cabinetBaseLf','cabinetUpperLf','cabinetTallLf','garageSqft','coveredOutdoorSqft'].includes(field);
    if (optional && !pricedFields.includes(field)) continue;
    if (numeric && !pricedFields.includes(field) && !fields.has(field)) continue;
    if (scopeFieldApplies(field, context)) fields.add(field);`);
 s=swap(s,"  if (field && !scopeFieldApplies(field, context)) return false;",`  // A pending source decision must not disappear merely because it has no answer.
  if (field === 'address') return false;
  const topic = field ? FIELD_TOPIC[field] : undefined;
  if (topic && excluded(context, topic)) return false;
  if (field === 'finish' && !scopeFieldApplies(field, context)) return false;
  if (field === 'garageSqft' && context.answers.garageIncluded === 'no') return false;
  if (field === 'cabinetRoom' && context.service && !context.service.startsWith('cabinet-')) return false;`);
 return s;
});
edit('lib/p5/adaptive.ts',s=>{
 s=swap(s,"  if(!answers.service)return [questionForField('service',answers)];","  if(!answers.service&&!applicableConflicts.length)return [questionForField('service',answers)];");
 s=swap(s,'reason:`We found ${fact.value} for ${SCOPE_FIELDS[fact.field].label.toLowerCase()} in ${fact.source}. Is that correct?`','reason:`${SCOPE_FIELDS[fact.field].label}: we found ${fact.value} in ${fact.source}. Is that correct?`');
 s=swap(s,"reason:q.question,detail:q.reason});","reason:SCOPE_FIELDS[q.field].kind==='number'&&!/how (?:many|much|long|wide|large)|number of|square feet|linear feet|footage/i.test(q.question)?questionReason(q.field,answers):q.question,detail:q.reason});");
 return s;
});
const legacy='tests/p5-adaptive.test.ts';
if(fs.existsSync(legacy))edit(legacy,s=>s.replace("test('finish level is asked whenever it is missing on work it prices, and never for repairs'","test('specified materials replace generic finish tiers; unspecified scopes retain their planning assumption'")
 .replace("assert.ok(asked.includes('finish'),'described materials do not replace the finish level');","assert.ok(!asked.includes('finish'),'specified materials must not trigger a redundant generic finish tier');"));
const testFile='tests/p5-dynamic-questions.test.ts';
edit(testFile,s=>s.includes("regression: room-level quantity covers the selected bathroom assembly")?s:s+`

test('regression: room-level quantity covers the selected bathroom assembly',()=>assert.deepEqual(scopeQuestions({service:'bathroom',sqft:'80',materials:'Porcelain tile',finish:'mid-range',demolition:'Remove tile and vanity'},null),[]));
test('regression: known cabinet runs are already a description of the requested cabinet work',()=>assert.deepEqual(scopeQuestions({service:'cabinet-install',cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0',finish:'mid-range'},null,[],[],['cabinetBaseLf','cabinetUpperLf']),[]));
test('regression: optional location prompts do not reappear as mandatory follow-ups',()=>assert.deepEqual(scopeQuestions(build(),extraction({clarifications:[{field:'location',question:'What is the street address?',reason:'Optional visit detail'}]})),[]));
test('regression: pending cabinet questions are not discarded merely because quantities are unknown',()=>{const x=extraction({instructions:instructions({questions:['What are the cabinet lengths?','What is the cabinet room type?']})});const q=scopeQuestions({service:'cabinet-install',cabinetBaseLf:'20'},x);assert.equal(q[0].field,'cabinetUpperLf');});
test('regression: a numeric input is paired with a numeric answer prompt',()=>{const a={service:'bathroom',sqft:'80',materials:'Porcelain tile',demolition:'Remove tile',finish:'mid-range'};const x=extraction({clarifications:[{field:'fixtureCount',question:'Which fixtures and who supplies them?',reason:'Scope'}]});assert.deepEqual(scopeQuestions(a,x),[]);assert.match(scopeQuestions(a,x,[],[],['fixtureCount'])[0].reason,/number of fixtures/i);});
`);
console.log('Reconciled room assemblies, source-backed questions, numeric prompts and optional follow-ups.');
