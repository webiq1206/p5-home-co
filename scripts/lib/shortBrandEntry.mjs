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
  const link=page.locator('a[href="/#request"]:visible').first();await link.click();
  const form=page.locator('#request-form form');await form.waitFor({state:'visible'});
  const send=form.getByRole('button',{name:'Send request',exact:true});await clearAction(send);
  await send.click();assert.ok(await form.getByRole('alert').isVisible());
  await form.getByLabel('Name',{exact:true}).fill('Synthetic Navigation Check');
  await form.getByLabel('Phone',{exact:true}).fill('2025550102');
  await form.getByLabel('Email (optional)',{exact:true}).fill('navigation@example.invalid');
  await form.getByLabel('What can we help with?',{exact:true}).fill('Synthetic local-only request. '+'LongUnbrokenMaterialSpecification'.repeat(20));
  await clearAction(send);assert.equal(await page.locator('h1').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));return;
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

export const isHandyman = brand => ['handyman','boise-handyman-co'].includes(brand);
/** Current homepage request form (v2, owner 1 November): list first, attachment tile, call-back mode.
 * Same strength as the old wizard walk: empty-send errors and focus, bad phone, bad email, draft kept
 * on reload, unobstructed send, one h1, no overflow. Independent of the retained /estimate engine. */
export async function verifyHandymanHomeEntry(page) {
 await page.locator('main a[href="/contact"]:visible').first().click();
 await page.waitForURL(url=>url.pathname==='/contact');
 const form=page.getByTestId('consultation-wizard');await form.waitFor();
 assert.equal(await form.getAttribute('data-step'),'request');
 const focused=()=>page.evaluate(()=>document.activeElement?.getAttribute('data-testid'));
 const send=form.getByTestId('button-consult-submit');
 assert.equal((await send.innerText()).trim(),'Send my list');
 // The list is the first field; the attachment tile takes photos and PDFs.
 assert.equal(await form.locator('textarea, input:not([type=radio]):not([type=hidden]):not(.hm-form-honeypot), select').first().getAttribute('data-testid'),'textarea-message');
 assert.equal(await form.getByTestId('input-files').getAttribute('accept'),'image/*,application/pdf,.heic,.heif');
 // Empty send: summary alert, the list focused, the list, name and phone errors shown.
 await clearAction(send);await send.click();
 assert.ok(await form.getByRole('alert').isVisible());assert.equal(await focused(),'textarea-message');
 for(const field of ['message','name','phone'])assert.notEqual((await form.getByTestId(`error-${field}`).innerText()).trim(),'');
 const note='Synthetic request retained locally only. '+'LongUnbrokenMaterialSpecification'.repeat(20);
 await form.getByTestId('textarea-message').fill(note);
 await form.getByTestId('input-name').fill('Synthetic Navigation Check');
 // Bad phone.
 await form.getByTestId('input-phone').fill('123');await send.click();
 assert.equal(await focused(),'input-phone');assert.ok(await form.getByRole('alert').isVisible());
 await form.getByTestId('input-phone').fill('2025550102');
 // Email preferred: email becomes required; a bad one is caught.
 await form.getByTestId('button-preferred-contact-email').check();
 await form.getByTestId('input-email').fill('invalid');await send.click();
 assert.equal(await focused(),'input-email');assert.ok(await form.getByRole('alert').isVisible());
 await form.getByTestId('input-email').fill('navigation@example.invalid');
 // Draft kept on reload.
 await page.reload();await form.waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-testid="input-email"]')?.value==='navigation@example.invalid');
 assert.equal(await form.getByTestId('textarea-message').inputValue(),note);
 assert.equal(await form.getByTestId('input-name').inputValue(),'Synthetic Navigation Check');
 assert.equal(await form.getByTestId('input-phone').inputValue(),'2025550102');
 assert.equal(await form.getByTestId('button-preferred-contact-email').isChecked(),true);
 // "Have us call you" reduces the form, and switches back.
 await form.getByTestId('request-mode-callback').check();
 await page.waitForFunction(()=>document.querySelector('[data-testid="consultation-wizard"]')?.dataset.step==='callback');
 assert.equal(await form.getByTestId('textarea-message').count(),0);assert.ok(await form.getByTestId('select-best-time').isVisible());
 assert.equal((await send.innerText()).trim(),'Request a call');
 await form.getByTestId('request-mode-request').check();
 assert.equal(await form.getByTestId('textarea-message').inputValue(),note);
 await clearAction(send);
 assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // Stop before final Send. All service and external requests are blocked by caller.
}
