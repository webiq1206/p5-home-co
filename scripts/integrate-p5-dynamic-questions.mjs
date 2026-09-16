import fs from 'node:fs';
import path from 'node:path';
const read=p=>fs.readFileSync(p,'utf8');
const put=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const replace=(p,from,to)=>{let s=read(p);if(s.includes(to))return;if(!s.includes(from))throw new Error(`Expected integration point missing: ${p}: ${from.slice(0,90)}`);put(p,s.replace(from,to));};
replace('lib/p5/clarifications.ts',"import {atomicInstructionQuestions","import {questionContext,scopePromptApplies} from './dynamicQuestions.ts';\nimport {atomicInstructionQuestions");
replace('lib/p5/clarifications.ts','  return result;\n}\n\n/** Only the three exact responsibility choices','  return result.filter(q=>scopePromptApplies(q.field,q.detail||q.question,questionContext(answers,extraction)));\n}\n\n/** Only the three exact responsibility choices');
replace('components/P5Estimator.tsx',"const questions=(d:BrowserDraft)=>scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[]);","const questions=(d:BrowserDraft)=>scopeQuestions(d.answers,d.extraction,d.conflicts||[],d.wizard?.skipped||[],d.pricedFields||[],d.text);");
let endpoint=read('lib/p5/draftEndpoint.ts');
endpoint=endpoint.replace('scopeQuestions(currentAnswers,currentExtraction,conflicts,existing.wizard?.skipped||[],pricedFields)','scopeQuestions(currentAnswers,currentExtraction,conflicts,existing.wizard?.skipped||[],pricedFields,existing.text)');
endpoint=endpoint.replace('scopeQuestions(answers,extraction,conflicts,skipped,pricedFields)','scopeQuestions(answers,extraction,conflicts,skipped,pricedFields,incomingText)');
const gate='      const unresolved=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];';
const gateEnd='      reviewed={text:incomingText,answers,extraction,uncertainFields:skipped,';
const start=endpoint.indexOf(gate),end=endpoint.indexOf(gateEnd,start);
if(start<0||end<0)throw new Error('Draft review gate changed; inspect before integration.');
endpoint=endpoint.slice(0,start)+`      const unresolved=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];
      const dependencies=await costQuestionFields(answers);
      const remaining=scopeQuestions(answers,extraction,unresolved,skipped,dependencies,incomingText);
      if(remaining.length)throw new DraftError(remaining[0].handoff?'Use the matching company estimator for this project.':\`Answer the remaining \${remaining[0].label.toLowerCase()} question before continuing.\`);
`+endpoint.slice(end);
put('lib/p5/draftEndpoint.ts',endpoint);
let ui=read('components/P5Estimator.tsx');
ui=ui.replaceAll("const thread=threadRef.current;if(!el)return;","const thread=threadRef.current;if(!el||!frameActive)return;");
ui=ui.replace("if(!draft||!stageKey||working||stageKey===lastStage.current)return;","if(!frameActive||!draft||!stageKey||working||stageKey===lastStage.current)return;");
ui=ui.replace("},[stageKey,working,Boolean(draft)]);","},[stageKey,working,Boolean(draft),frameActive]);");
ui=ui.replace("open={group.title==='Project at a glance'||group.fields.includes(editField as ScopeField)}","open={group.fields.includes(editField as ScopeField)||undefined}");
ui=ui.replace('open={!draft.answers.finish}','open={false}');
const pdfCard='<div className={styles.card} aria-label="Estimate PDF attachment"><div className={styles.cardHead}><h3>Your estimate PDF</h3><span className={styles.badge}>PDF</span></div><p className={styles.hint}>Includes your price range, scope, exclusions and planning assumptions.</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={downloadPdf} disabled={locked}>Download estimate PDF</button></div></div>';
if(!ui.includes('aria-label="Estimate PDF attachment"')){
 const target=/<P5EstimateDetails result=\{result\}(?: openFirst=\{false\})?\s*\/>/;
 if(!target.test(ui))throw new Error('Result detail integration point changed.');
 ui=ui.replace(target,pdfCard+'<P5EstimateDetails result={result} openFirst={false}/>');
}
ui=ui.replace('`${brand.id}-project-summary.pdf`','`${brand.id}-estimate.pdf`');
const finishStart=ui.indexOf("    {finishServices.includes(draft.answers.service||'')&&<div className={styles.card}>");
if(finishStart>=0){
 const finishEnd=ui.indexOf('    {warningCard}',finishStart);if(finishEnd<0)throw new Error('Finish section boundary missing.');
 let part=ui.slice(finishStart,finishEnd);
 part=part.replace('&&<div className={styles.card}>','&&<details className={styles.accordion}><summary><span className={styles.accordionTitle}>Finish selections</span><span className={styles.accordionMeta}>{draft.answers.finish?readable(\'finish\',draft.answers.finish):\'Planning allowances\'}</span></summary><div className={styles.accordionBody}>');
 part=part.replace(/<\/div>}\s*$/,'</div></details>}\n');ui=ui.slice(0,finishStart)+part+ui.slice(finishEnd);
}
ui=ui.replace('{entry.text&&<p className={styles.msgText}>{entry.text}</p>}','{entry.text&&(entry.text.length>500?<details className={styles.accordion}><summary><span className={styles.accordionTitle}>View full message</span></summary><div className={styles.accordionBody}><p className={styles.msgText}>{entry.text}</p></div></details>:<p className={styles.msgText}>{entry.text}</p>)}');
put('components/P5Estimator.tsx',ui);
let details=read('components/P5EstimateDetails.tsx');
details=details.replace('openFirst=true','openFirst=false').replace('open={i===0&&!hasCategories}','open={false}').replace('section={s} open={i===0}','section={s} open={false}');
put('components/P5EstimateDetails.tsx',details);
const css='components/P5Estimator.module.css',marker='/* Project-specific chat question presentation. */';
let style=read(css);if(style.includes(marker))style=style.slice(0,style.indexOf(marker));
style+=`\n${marker}
.root .question{padding:0;border:0;background:transparent;border-radius:0}
.root .question h2{font-family:inherit;font-size:18px;line-height:1.45;letter-spacing:0}
.root .question .choices{display:flex;flex-wrap:wrap;gap:8px}
.root .question .choice{width:auto;min-height:44px;padding:9px 14px;border-radius:16px;flex:0 1 auto;font-size:15px}
.root .question .choice::before{display:none}
.root .composerText{min-height:44px}
@media(max-width:600px){.root .composer{padding:8px 10px}.root .threadInner{padding:16px 14px 20px}.root .questionActions{gap:8px}.root .accordionTitle{font-size:14px}}
`;
put(css,style);
let pricing=read('lib/p5/scopePricing.ts');
const catchMarker='    // Preserve the lead, but never expose a partial total on provider failure,';
if(pricing.includes(catchMarker)&&!pricing.includes('[p5-pricing] scope verification failure')){pricing=pricing.replace(catchMarker,"    console.error('[p5-pricing] scope verification failure', {name:error instanceof Error?error.name:'UnknownError',message:error instanceof Error?error.message:'Invalid pricing response'});\n"+catchMarker);put('lib/p5/scopePricing.ts',pricing);}
// A supported numeric allowance is valid. An unpriced item relabeled as an assumption is not.
let cost=read('lib/p5/costBook.ts');
for(const code of ['scope-pricing-preliminary','planning-catalog-review','quantity-preliminary','allowance-preliminary']){
 if(!cost.includes(code))continue;
 const pattern=new RegExp(`if\\(preliminaryModel\\)estimate\\.warnings\\.push\\(\\{code:['\"]${code}['\"][^{}]*\\}\\);\\s*else\\{(estimate\\.publishable=false;estimate\\.warnings\\.push\\(\\{[^{}]*\\}\\);)\\}`);
 if(!pattern.test(cost))throw new Error(`Inspect changed pricing safeguard: ${code}`);
 cost=cost.replace(pattern,'$1');
}
put('lib/p5/costBook.ts',cost);
console.log('Integrated project-specific question policy, server gates, chat presentation and pricing safeguards.');
