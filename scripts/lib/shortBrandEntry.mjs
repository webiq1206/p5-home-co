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
 // Email is optional, so it sits behind the one closed quiet toggle until opened.
 assert.equal(await form.getByLabel('Email',{exact:true}).isVisible(),false);
 await form.getByTestId('quote-options').locator('summary').click();
 // The optional project address is the toggle's first field and is never required.
 await form.getByLabel('Project address',{exact:true}).fill('123 Synthetic St, Boise, ID 83702');
 await form.getByLabel('Email',{exact:true}).fill('invalid');await next.click();assert.ok(await form.getByRole('alert').isVisible());
 await form.getByLabel('Email',{exact:true}).fill('navigation@example.invalid');await next.click();
 const note='Synthetic request retained locally only. '+'LongUnbrokenMaterialSpecification'.repeat(20);
 await form.getByLabel('Project',{exact:true}).fill(note);
 await clearAction(page.getByTestId('button-estimate-quote-submit'));
 assert.equal(await form.getAttribute('data-quote-step'),'project');
 await page.reload();await form.getByLabel('Project',{exact:true}).waitFor();
 assert.equal(await form.getByLabel('Project',{exact:true}).inputValue(),note);
 // "Have us call you" is the text link under the fields; "Send a request" (the
 // old Back test id) is the link that replaces it in callback mode and returns
 // to the full request with every value kept.
 await page.getByTestId('button-quote-callback').click();
 assert.equal(await page.getByRole('radio',{name:'Have us call you',exact:true}).isChecked(),true);
 assert.equal(await form.getByLabel('Project',{exact:true}).count(),0);
 await page.getByTestId('button-estimate-quote-back').click();
 assert.equal(await page.getByRole('radio',{name:'Send a request',exact:true}).isChecked(),true);
 assert.equal(await form.getByLabel('Project',{exact:true}).inputValue(),note);
 assert.equal(await form.getByLabel('Project address',{exact:true}).inputValue(),'123 Synthetic St, Boise, ID 83702');
 assert.equal(await form.getByLabel('Email',{exact:true}).inputValue(),'navigation@example.invalid');
 const planner=page.getByTestId('estimate-d2-details');
 await planner.locator('summary').focus();await planner.locator('summary').press('Enter');
 assert.equal(await planner.evaluate(el=>el.open),true);
 assert.ok(await planner.locator('[data-estimate-wizard]').isVisible());
 assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}

export async function verifyRemodelingEntry(page,path) {
 // One short request everywhere (owner, 11 November): the homepage block and /estimate, which
 // was a six-step wizard, mount the same form.
 const home=path==='/'||path==='/#request';
 if(home) await page.locator('a[href="/#request"]:visible').first().click();
 const form=page.locator((home?'#request-form':'#estimate-request-form')+' form');await form.waitFor({state:'visible'});
 const send=form.getByRole('button',{name:'Send request',exact:true});await clearAction(send);
 await send.click();assert.ok(await form.getByRole('alert').isVisible());
 await form.getByLabel('Name',{exact:true}).fill('Synthetic Navigation Check');
 await form.getByLabel('Phone',{exact:true}).fill('123');await send.click();
 assert.equal(await form.getByLabel('Phone',{exact:true}).getAttribute('aria-invalid'),'true');
 await form.getByLabel('Phone',{exact:true}).fill('2025550102');
 // Address and email are optional, so they sit behind the one closed toggle until opened.
 assert.equal(await form.getByLabel('Email (optional)',{exact:true}).isVisible(),false);
 assert.equal(await form.getByLabel('Project address',{exact:true}).isVisible(),false);
 await form.getByTestId('quote-options').locator('summary').click();
 await form.getByLabel('Project address',{exact:true}).fill('123 Synthetic St, Boise, ID 83702');
 await form.getByLabel('Email (optional)',{exact:true}).fill('invalid');
 await form.getByLabel('What can we help with?',{exact:true}).fill('Synthetic local-only request. '+'LongUnbrokenMaterialSpecification'.repeat(20));
 await send.click();assert.equal(await form.getByLabel('Email (optional)',{exact:true}).getAttribute('aria-invalid'),'true');
 await form.getByLabel('Email (optional)',{exact:true}).fill('navigation@example.invalid');
 await clearAction(send);assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // Stop before final Send. All service and external requests are blocked by caller.
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
/** Current homepage request form (v2, owner 1 November; 11 November: only the list, name and phone show,
 * every optional field sits behind one quiet text toggle, files move to after sending, and nothing else
 * is in the form but the button and two quiet lines), call-back mode.
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
 // The list is the first field. Step 1 shows only the list, name and phone: no file control, and the
 // optional email and reply choice wait behind one closed text toggle. No step indicator, no tabs.
 assert.equal(await form.locator('textarea, input:not([type=radio]):not([type=hidden]):not(.hm-form-honeypot), select').first().getAttribute('data-testid'),'textarea-message');
 assert.equal(await form.locator('input[type=file]').count(),0,'Files are added on Step 2, after the request is sent');
 assert.deepEqual(await form.locator('textarea, input:not([type=radio]):not([type=hidden]):not(.hm-form-honeypot), select').evaluateAll(els=>els.filter(el=>el.checkVisibility()).map(el=>el.getAttribute('data-testid'))),['textarea-message','input-name','input-phone']);
 assert.equal(await form.locator('[data-quote-steps], .hm-form-tab, [data-testid="consult-send-footnote"]').count(),0,'No step indicator, tabs or footnote');
 const options=form.getByTestId('quote-options');
 assert.equal(await options.evaluate(el=>el.open),false,'Optional fields start closed');
 assert.equal((await options.locator('summary').innerText()).replace(/\s+/g,' ').trim(),'Add address, email or contact preference (optional)');
 assert.deepEqual(await options.evaluate(el=>{const c=getComputedStyle(el);return [c.borderTopWidth,c.backgroundColor,c.paddingTop];}),['0px','rgba(0, 0, 0, 0)','0px'],'The toggle is a line of text, not a box');
 assert.equal(await form.getByTestId('input-email').isVisible(),false);
 // One quiet line under the button: the call link and the callback switch as a text link. The active
 // mode's radio stays in the page, checked, with its label visually hidden.
 assert.equal(await form.getByTestId('request-mode-request').isChecked(),true);
 const shownModes=()=>form.locator('fieldset.hm-form-mode label').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width>1).map(el=>el.textContent.trim()));
 assert.deepEqual(await shownModes(),['Have us call you']);
 assert.match(await form.locator('fieldset.hm-form-mode p').evaluate(el=>el.textContent),/^Prefer to talk\? Call \(\d{3}\) \d{3}-\d{4} or /);
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
 // Email preferred (inside the dropdown): email becomes required. Sending without one from the closed
 // dropdown opens it and focuses the email; a bad one is caught.
 await options.locator('summary').click();
 // The optional job address is the first field in the toggle, above the email; it is never required.
 assert.deepEqual(await options.locator('input:not([type=radio])').evaluateAll(els=>els.map(el=>el.getAttribute('data-testid'))),['input-address','input-email']);
 assert.equal(await form.getByTestId('input-address').getAttribute('autocomplete'),'street-address');
 assert.equal(await form.getByTestId('input-address').getAttribute('aria-required'),null);
 await form.getByTestId('input-address').fill('100 Synthetic Way, Boise');
 await form.getByTestId('button-preferred-contact-email').check();
 await options.locator('summary').click();assert.equal(await options.evaluate(el=>el.open),false);
 await send.click();
 assert.equal(await options.evaluate(el=>el.open),true,'A needed email opens the dropdown');
 assert.equal(await focused(),'input-email');assert.ok(await form.getByRole('alert').isVisible());
 await form.getByTestId('input-email').fill('invalid');await send.click();
 assert.equal(await focused(),'input-email');assert.ok(await form.getByRole('alert').isVisible());
 await form.getByTestId('input-email').fill('navigation@example.invalid');
 // Draft kept on reload.
 await page.reload();await form.waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-testid="input-email"]')?.value==='navigation@example.invalid');
 assert.equal(await form.getByTestId('textarea-message').inputValue(),note);
 assert.equal(await form.getByTestId('input-name').inputValue(),'Synthetic Navigation Check');
 assert.equal(await form.getByTestId('input-phone').inputValue(),'2025550102');
 assert.equal(await form.getByTestId('input-address').inputValue(),'100 Synthetic Way, Boise');
 // A restored draft with an email or a reply choice shows the dropdown open, never hides what was entered.
 assert.equal(await options.evaluate(el=>el.open),true);
 assert.equal(await form.getByTestId('button-preferred-contact-email').isChecked(),true);
 // "Have us call you" reduces the form, and switches back.
 await form.getByTestId('request-mode-callback').check();
 await page.waitForFunction(()=>document.querySelector('[data-testid="consultation-wizard"]')?.dataset.step==='callback');
 assert.equal(await form.getByTestId('textarea-message').count(),0);assert.ok(await form.getByTestId('select-best-time').isVisible());
 assert.equal((await send.innerText()).trim(),'Request a call');
 assert.deepEqual(await shownModes(),['Send a request']);
 assert.match(await form.locator('fieldset.hm-form-mode p').evaluate(el=>el.textContent),/^Rather write it down\? /);
 await form.getByTestId('request-mode-request').check();
 assert.equal(await form.getByTestId('textarea-message').inputValue(),note);
 await clearAction(send);
 assert.equal(await page.locator('h1').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // Stop before final Send. All service and external requests are blocked by caller.
}
