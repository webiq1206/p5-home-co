/* Source-bound public CTA fixture. Does not load estimator, forms, analytics or providers. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const brand=process.argv[2];assert.ok(['p5','cabinet'].includes(brand));
const root=process.cwd(),out='test-results/planning-contact';fs.mkdirSync(out,{recursive:true});
const sourcePath=brand==='p5'?'components/CompanyFinder.tsx':'app/estimate/page.tsx';
const after=fs.readFileSync(sourcePath,'utf8'),before=fs.readFileSync('tests/fixtures/planning-contact-before.tsx.txt','utf8');
const sourceHashes={before:crypto.createHash('sha256').update(before).digest('hex'),after:crypto.createHash('sha256').update(after).digest('hex')};
const records=[],html={};
const el=React.createElement;
const anchor=({children,...props})=>el('a',props,children);
const Arrow=()=>el('span',{'aria-hidden':true},' ↗');
const FamilyButton=({children,size='md',variant='primary',href,target,rel,style})=>el('a',{href,target,rel,style,className:`fam-btn fam-btn--${variant} fam-btn--${size}`},children);
function load(source,state){
 const m={exports:{}};
 const mocks={react:{...React,useState:()=>[state.company,v=>{state.company=v}],useEffect:()=>{}},'react/jsx-runtime':require('react/jsx-runtime'),'next/link':{default:anchor},'@/components/Arrow':{default:Arrow},'@/components/family/Button':{FamilyButton},'@/app/analytics':{track:()=>{throw Error('Analytics must not execute in fixture')}},'@/app/publicIdentity':{ADU_CONSTRUCTION_URL:'https://boiseconstruction.co/adu',ADU_D3_LINE:'ADU planning. Fixture copy, not a new business claim.'},'@/components/marketing/AboveFoldActions':{AboveFoldActions:()=>null},'@/components/approved/ApprovedBrand':{ApprovedBrand:()=>el('span',{},'Boise Cabinet Co')},'@/components/marketing/KitchenCabinetsQuoteForm':{KitchenCabinetsQuoteForm:()=>el('div',{'data-fixture':'contact'},'Contact form fixture. No inquiry controls or delivery.')},'@/lib/brand-page-metadata':{withBrandPageMetadata:x=>x},'@/components/seo/JsonLd':{JsonLd:()=>null},'@/components/Breadcrumbs':{Breadcrumbs:()=>null},'@/components/estimate/LazyEstimateCalculatorWizard':{LazyEstimateCalculatorWizard:()=>el('div',{'data-fixture':'protected-wizard',style:{minHeight:180}},`Protected wizard omitted. Representative ${state.wizard} state.`)},'@/lib/catalog-metadata':{catalogMetadata:()=>({}),catalogDescription:x=>x},'@/lib/page-metadata':{buildCanonical:x=>x},'@/lib/schema':{generateBreadcrumbSchema:()=>({}),generateWebPageSchema:()=>({})}};
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 assert.equal(compiled.diagnostics?.length||0,0);
 vm.runInNewContext(compiled.outputText,{module:m,exports:m.exports,require:n=>{assert.ok(n in mocks,`Unexpected dependency ${n}`);return mocks[n]}});
 return ()=>m.exports.default();
}
function nodes(x){if(Array.isArray(x))return x.flatMap(nodes);if(!x||typeof x!=='object')return[];return[x,...nodes(x.props?.children)]}
function text(x){if(Array.isArray(x))return x.map(text).join('');if(typeof x==='string')return x;return x?.props?text(x.props.children):''}
function record(phase,name,tree){
 const ctas=nodes(tree).filter(x=>x.props?.href&&/Request a (?:cabinet )?quote/.test(text(x)));
 if(phase==='after')assert.equal(ctas.length,1,`${name} exactly one quote link`);
 const expected=brand==='cabinet'?'/estimate#estimate-request':({construction:'/quote/custom-home',remodeling:'/quote',cabinetry:'/quote/custom-cabinets',handyman:'/quote/handyman',adu:'/quote/adu'}[name]||'/quote');
 if(ctas.length)assert.equal(ctas[0].props.href,expected);
 let markup=renderToStaticMarkup(tree);
 if(brand==='cabinet'){assert.match(markup,/id="estimate-request"/);markup=markup.replace('<details ','<details open ')}
 records.push({phase,name,ctaCount:ctas.length,href:ctas[0]?.props.href||null});html[`${phase}/${name}`]=markup;
}
for(const [phase,source] of [['before',before],['after',after]]){
 if(brand==='p5'){
  const state={company:null},render=load(source,state);record(phase,'initial',render());
  for(const company of ['construction','remodeling','cabinetry','handyman','adu']){
   state.company=null;const buttons=nodes(render()).filter(x=>x.type==='button'&&x.props.onClick);const index=['construction','remodeling','cabinetry','handyman','adu'].indexOf(company);buttons[index].props.onClick();assert.equal(state.company,company);record(phase,company,render());
   const reset=nodes(render()).find(x=>x.type==='button'&&text(x)==='Try another project');reset.props.onClick();assert.equal(state.company,null);
  }
  record(phase,'reset',render());
 }else{
  // Production page owns this anchor outside the wizard, therefore its state cannot condition the link.
  for(const wizard of ['initial','empty','result','contact'])record(phase,wizard,load(source,{wizard})());
  assert.ok(source.includes('<EstimateCalculatorWizard fitViewport />'));
  if(phase==='after')assert.ok(source.indexOf('data-testid="planning-contact-cta"')<source.indexOf('<EstimateCalculatorWizard fitViewport />'));
 }
}
fs.writeFileSync(`${out}/source-report.json`,JSON.stringify({brand,sourcePath,sourceHashes,records,limitations:'Exact production wrapper/component with protected form/wizard and analytics imports stubbed. No pricing, submission, provider or full-wizard visual acceptance.'},null,2));
if(process.argv.includes('--source-only')){console.log(JSON.stringify({brand,states:records.length,sourceHashes}));process.exit(0)}
(async()=>{
 const cssFiles=brand==='p5'?['styles/family-tokens.css','app/globals.css','styles/family-chrome.css','app/family-adoption.css']:['test-results/planning-contact/tailwind.css','app/family.css','app/approved-family.css','app/approved-cabinet.css','app/approved-system.css','app/approved-interiors.css','app/audit-accessibility.css','app/design-refresh.css','app/family-redesign.css','styles/family-tokens.css','styles/family-chrome.css','app/family-adoption.css'];
 const css=cssFiles.map(p=>fs.readFileSync(p,'utf8')).join('\n');
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(req.method!=='GET'){res.writeHead(405);return res.end()};const key=u.searchParams.get('fixture')||'after/initial';if(u.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css)};res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body>${html[key]||'<p>Verified route destination fixture. No real form.</p>'}</body></html>`)});
 await new Promise(r=>server.listen(34865,'127.0.0.1',r));
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'}),origin='http://127.0.0.1:34865';
 const blocked=[];await context.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin===origin&&q.method()==='GET'&&!u.pathname.startsWith('/api/'))return r.continue();blocked.push(q.url());return r.abort()});await context.routeWebSocket('**/*',s=>s.close());
 const measurements=[],failures=[];
 try{for(const [w,h] of [[320,568],[360,640],[390,844],[430,932],[768,1024],[1024,768],[1280,720],[1440,900],[1920,1080],[844,390]])for(const rec of records){
  const page=await context.newPage();await page.setViewportSize({width:w,height:h});await page.goto(`${origin}${brand==='cabinet'?'/estimate':'/'}?fixture=${rec.phase}/${rec.name}`,{waitUntil:'networkidle'});
  const section=brand==='p5'?page.locator('#company-finder'):page.locator('[data-testid="estimate-d2-details"]');const cta=section.getByRole('link',{name:/Request a (?:cabinet )?quote/});
  const count=await cta.count();assert.equal(count,rec.ctaCount);let box=null;
  if(count){box=await cta.boundingBox();assert.ok(box.width>0&&box.height>0);if(rec.phase==='after'){await cta.focus();await Promise.all([page.waitForURL(u=>u.pathname+u.hash===rec.href),page.keyboard.press('Enter')]);assert.equal(new URL(page.url()).pathname+new URL(page.url()).hash,rec.href);await page.goBack();}}
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)failures.push(`${w}x${h} ${rec.phase}/${rec.name} overflow`);
  await section.screenshot({path:`${out}/${rec.phase}-${rec.name}-${w}x${h}.png`});measurements.push({...rec,viewport:`${w}x${h}`,box,overflow});await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify({brand,sourceHashes,measurements,failures,blocked,limitations:'Isolated source-bound fixture with production CSS. Font fallbacks may differ. Not full-site or protected-wizard verification.'},null,2));assert.equal(failures.length,0,failures.join('\n'));console.log(JSON.stringify({brand,states:measurements.length,failures,blocked:blocked.length}));
})().catch(e=>{console.error(e);process.exitCode=1});
