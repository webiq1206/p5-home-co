import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Component interaction tests use synthetic data. They do not authenticate to
// an administrator account or write a policy to any live database.
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {P5OverheadReview} from './components/P5OverheadReview';
import {P5LinePricing} from './components/P5LinePricing';
const estimate={lines:[{id:'paint',trade:'Painting',description:'Prepare and paint a room',quantity:100,unit:'SF',unitCost:3,cost:300,contingency:30,overheadRecovery:110,operatingProfit:110,sellingAmount:550,sellingUnitPrice:5.5},{id:'drywall',trade:'Drywall',description:'Repair drywall',quantity:10,unit:'SF',unitCost:5.4,cost:54,contingency:0,overheadRecovery:18,operatingProfit:18,sellingAmount:90,sellingUnitPrice:9}]};
function App(){const [configuration,setConfiguration]=useState(JSON.stringify({finance:{annualOverhead:420000,annualRevenue:null,forecastSource:''},costBooks:[{id:'preserve-existing-book'}]}));const [saved,setSaved]=useState('');return <main style={{maxWidth:1100,margin:'0 auto',padding:20,overflowWrap:'anywhere'}}><h1>Estimator pricing review</h1><p>Synthetic component verification only.</p><P5OverheadReview configuration={configuration} onChange={setConfiguration} onSave={()=>setSaved(configuration)} busy={false} rate={.20} warnings={[]}/><p role="status">{saved}</p><P5LinePricing estimate={estimate}/></main>;}createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
await mkdir('p5-verification',{recursive:true});
const browser=await chromium.launch();const results=[];
for(const width of [320,390,430,768,1024,1440,1920]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial,sans-serif;color:#17201b;background:#faf9f6}*{box-sizing:border-box;min-width:0}h1{font-size:28px}input{max-width:100%}button{cursor:pointer;font:inherit}p{line-height:1.5}</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:built.outputFiles[0].text});
  await page.getByRole('heading',{name:'Overhead recovery',exact:true}).waitFor();
  assert.match(await page.getByRole('region',{name:'Overhead recovery policy'}).innerText(),/Advertising is counted once/);
  await page.getByLabel('Conservative annual earned-revenue forecast, optional ($)',{exact:true}).fill('2400000');
  await page.getByLabel('Forecast source and review period',{exact:true}).fill('Synthetic quarterly forecast review');
  await page.getByRole('button',{name:'Save quarterly overhead review',exact:true}).click();
  const saved=JSON.parse(await page.getByRole('status').innerText());assert.equal(saved.finance.annualRevenue,2400000);assert.equal(saved.finance.annualOverhead,420000);assert.equal(saved.costBooks[0].id,'preserve-existing-book');
  await page.getByLabel('Find a priced item',{exact:true}).fill('Drywall');
  await page.getByText('Drywall: Repair drywall ($90.00)',{exact:true}).click();
  assert.equal(await page.getByText('Painting: Prepare and paint a room ($550.00)',{exact:true}).count(),0);
  const breakdown=page.getByRole('region',{name:'Item pricing breakdown'});assert.match(await breakdown.innerText(),/Overhead recovery/);assert.match(await breakdown.innerText(),/\$18.00/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Administrator pricing components overflow');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`p5-verification/${width}-admin-pricing.png`,fullPage:true});
  results.push({width,passed:true});
 }catch(e){results.push({width,passed:false,error:String(e),errors});await page.screenshot({path:`p5-verification/${width}-admin-pricing-failure.png`,fullPage:true}).catch(()=>{});}
 await page.close();
}
await browser.close();await writeFile('p5-verification/admin-component-results.json',JSON.stringify({scope:'Isolated administrator components with synthetic data; no live authentication or policy save.',results},null,2));console.log(JSON.stringify(results));
if(results.some(r=>!r.passed))process.exitCode=1;
