import assert from 'node:assert/strict';

export const isCabinet = brand => ['cabinet','boise-cabinet-co'].includes(brand);
export const isRemodeling = brand => ['remodeling','boise-remodeling-co'].includes(brand);

async function clearAction(button) {
 await button.scrollIntoViewIfNeeded();
 assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'Request action is visible and unobstructed');
}

/** Current public forms; callers block business APIs. Never press final Send. */
export async function verifyCabinetEntry(page,path='/estimate') {
 if(path==='/') {
  await page.locator('a[href="/estimate"]:visible').first().click();
  await page.waitForURL(url=>url.pathname==='/estimate');
 }
 const form=page.locator('[data-c10-estimate-quote]');
 await form.getByLabel('Name',{exact:true}).waitFor();
 const next=page.getByTestId('button-estimate-quote-continue');
 await page.locator('body > [data-wizard-action-bar][data-wizard-action-bar-docked="true"]').filter({has:next}).waitFor();
 await clearAction(next);await next.click();assert.ok(await form.getByRole('alert').isVisible());
 await form.getByLabel('Name',{exact:true}).fill('Synthetic Navigation Check');await next.click();
 await form.getByLabel('Phone',{exact:true}).fill('123');await next.click();assert.ok(await form.getByRole('alert').isVisible());
 await form.getByLabel('Phone',{exact:true}).fill('2025550102');await next.click();
 await form.getByLabel('Email',{exact:true}).fill('invalid');await next.click();assert.ok(await form.getByRole('alert').isVisible());
 await form.getByLabel('Email',{exact:true}).fill('navigation@example.invalid');await next.click();
 const note='Synthetic request retained locally only. '+'LongUnbrokenMaterialSpecification'.repeat(20);
 await form.getByLabel('Project',{exact:true}).fill(note);
 await clearAction(page.getByTestId('button-estimate-quote-submit'));
 assert.equal(await form.getAttribute('data-quote-step'),'project');
 await page.reload();await form.getByLabel('Project',{exact:true}).waitFor();
 assert.equal(await form.getByLabel('Project',{exact:true}).inputValue(),note);
 await page.getByTestId('button-estimate-quote-back').click();
 assert.equal(await form.getByLabel('Email',{exact:true}).inputValue(),'navigation@example.invalid');
 const planner=page.getByTestId('estimate-d2-details');
 await planner.locator('summary').focus();await planner.locator('summary').press('Enter');
 assert.equal(await planner.evaluate(el=>el.open),true);
 assert.ok(await planner.locator('[data-estimate-wizard]').isVisible());
 assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}

export async function verifyRemodelingEntry(page,path) {
 if(path==='/'||path==='/#request') {
  await page.locator('a[href="/estimate"]:visible').first().click();
  await page.waitForURL(url=>url.pathname==='/estimate');
 }
 const wizard=page.getByTestId('estimate-request-wizard');await wizard.waitFor();
 const step=value=>wizard.locator(`[data-step="${value}"]`).waitFor();
 const next=wizard.getByTestId('estimate-wizard-next');
 await step('project');assert.equal(await next.isDisabled(),true);
 await wizard.getByRole('radio',{name:/^Kitchen/}).click();await next.click();await step('name');
 assert.equal(await next.isDisabled(),true);await wizard.getByRole('textbox',{name:'Name',exact:true}).fill('Synthetic Navigation Check');
 await next.click();await step('phone');await wizard.getByRole('textbox',{name:'Phone',exact:true}).fill('123');assert.equal(await next.isDisabled(),true);
 await wizard.getByRole('textbox',{name:'Phone',exact:true}).fill('2025550102');await next.click();await step('email');
 await wizard.getByRole('textbox',{name:'Email',exact:true}).fill('invalid');assert.equal(await next.isDisabled(),true);
 await wizard.getByRole('textbox',{name:'Email',exact:true}).fill('navigation@example.invalid');await next.click();await step('details');
 assert.equal(await next.isDisabled(),true);
 await wizard.locator('textarea[name="message"]').fill('Synthetic local-only request. '+'LongUnbrokenMaterialSpecification'.repeat(20));
 await next.click();await step('review');assert.match(await wizard.innerText(),/Synthetic Navigation Check/);
 await clearAction(next);assert.match(await next.innerText(),/Send request/);
 await page.reload();await step('review');assert.match(await wizard.innerText(),/Synthetic Navigation Check/);
 await wizard.getByRole('button',{name:'Back',exact:true}).click();await step('details');
 assert.match(await wizard.locator('textarea[name="message"]').inputValue(),/Synthetic local-only/);
 assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}

export async function verifyRemodelingRe10Handoff(page) {
 const destination='https://boisehandyman.co/re-10-repairs-boise';
 assert.equal(await page.getByRole('heading',{level:1}).count(),1);
 assert.match(await page.getByRole('heading',{level:1}).innerText(),/RE-10 and inspection repairs/);
 assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),destination);
 const link=page.getByRole('link',{name:'Go to Boise Handyman Co RE-10',exact:true});
 assert.equal(await link.getAttribute('href'),destination);await clearAction(link);
 assert.equal(await page.locator('[data-p5-estimator]').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}
