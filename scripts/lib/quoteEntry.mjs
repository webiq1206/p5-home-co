import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs','construction','boise-construction-co','cabinet','boise-cabinet-co','remodeling','boise-remodeling-co'].includes(brand) ? '/estimate/scope' : '/estimate';
export const isPublicQuotePath = path => path === '/estimate' || path === '/quote' || path.startsWith('/quote/');

/** Exercise the current public quote form without sending a request. The caller
 * supplies a fresh context with all business/third-party traffic blocked.
 * Owner, 1 November: one short screen that leads the page, with call, text
 * and "Have us call you" on the form itself. */
export async function verifyQuoteEntry(page, path) {
  if (path === '/estimate') assert.equal(new URL(page.url()).pathname, '/quote');
  const form = page.locator('form#request-form');
  await form.waitFor();
  await page.locator('form#request-form[data-ready]').waitFor();
  const name = form.getByLabel('Name',{exact:true});
  // The form leads the page: its heading and first field are on the first screen, under the sticky header.
  assert.ok(await name.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.querySelector('[data-family-header]')?.getBoundingClientRect().bottom??0,t=el.form.querySelector('h2').getBoundingClientRect();return scrollY<=1&&t.top>=h-1&&r.bottom<=innerHeight;}),'Quote heading and first field must be on the first screen');
  assert.equal(await page.evaluate(()=>document.activeElement?.matches('input,textarea,select')??false),false,'No field takes focus on arrival');
  const phone = form.getByLabel('Phone',{exact:true});
  const note = form.getByLabel('What do you need?',{exact:true});
  const email = form.locator('input[name="email"]');
  const send = form.getByRole('button',{name:'Send my request',exact:true});
  // An empty send names each problem in plain words and focuses the first one; nothing is sent.
  await send.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('autocomplete') === 'name');
  assert.equal(await name.getAttribute('aria-invalid'),'true');
  const errors = await form.innerText();
  for (const message of [/Enter your name\./,/Enter a phone number so we can reach you\./,/Tell us a little about what you need\./]) assert.match(errors, message);
  await name.fill('Synthetic Navigation Check');
  assert.equal(await name.getAttribute('aria-invalid'),null);
  await phone.fill('123'); await phone.blur();
  assert.equal(await phone.getAttribute('aria-invalid'),'true');
  await phone.fill('2085550102');
  assert.equal(await phone.getAttribute('aria-invalid'),null);
  assert.equal(await phone.getAttribute('type'),'tel');
  await note.fill('Synthetic navigation check. '+ 'LongUnbrokenMaterialSpecification'.repeat(20));
  await email.fill('invalid'); await email.blur();
  assert.match(await form.innerText(), /That email address does not look right\./);
  await email.fill('navigation@example.invalid');
  assert.equal(await form.locator('input[type=file]').count(),1);
  for (const label of ['Call me','Text me','Email me']) assert.equal(await form.getByRole('radio',{name:label,exact:true}).count(),1);
  // The type of work still routes the request to the company that owns it.
  const project = form.getByLabel('Type of project',{exact:true});
  if (!(await project.inputValue())) {
    await form.getByText('Add more detail (optional)',{exact:true}).click();
    await project.selectOption('Home repairs or handyman work');
    assert.match(await form.innerText(), /Goes to Boise Handyman Co\./);
  } else {
    assert.match(await project.evaluate(el=>el.closest('.quote-form-field').textContent), /Goes to .*Co\./);
  }
  await page.reload(); await page.locator('form#request-form[data-ready]').waitFor();
  assert.equal(await name.inputValue(),'Synthetic Navigation Check');
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // "Send a request" | "Have us call you": the callback side reduces the form to name and phone, then back.
  const request = form.getByRole('button',{name:'Send a request',exact:true});
  const callback = form.getByRole('button',{name:'Have us call you',exact:true});
  assert.equal(await request.getAttribute('aria-pressed'),'true');
  await callback.click();
  assert.equal(await callback.getAttribute('aria-pressed'),'true');
  assert.equal(await request.getAttribute('aria-pressed'),'false');
  assert.equal(await note.count(),0);
  assert.equal(await form.getByLabel(/^Best time to call/).count(),1);
  assert.equal(await form.getByRole('button',{name:'Request a call',exact:true}).count(),1);
  await request.click();
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // Call, text and chat stay on the form, each a 48px target.
  assert.equal(await form.locator('a[href^="tel:"]').count(),1);
  assert.equal(await form.locator('a[href^="sms:"]').count(),1);
  assert.equal(await form.getByRole('button',{name:'Chat',exact:true}).count(),1);
  for (const height of await form.locator('.quote-form-talk-button, .quote-form-mode').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height))) assert.ok(height>=47.5,'Contact and mode buttons are 48px tall');
  await send.scrollIntoViewIfNeeded();
  assert.ok(await send.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.height>=48&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}), 'Quote action must be unobstructed');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Quote horizontal overflow');
  // Deliberately stop before submission: no synthetic contact reaches a server.
}

export const isConstruction = brand => ['construction','boise-construction-co'].includes(brand);

/** Public Construction wizard, separate from the retained typed estimator. */
export async function verifyConstructionEntry(page, path) {
  if(path==='/' || path==='/#calculator'){
    await page.locator('a[href="/estimate"]:visible').first().click();
    await page.waitForURL(url=>url.pathname==='/estimate');
  }
  const form=page.getByTestId('consultation-wizard');
  const step=value=>page.waitForFunction(value=>document.querySelector('[data-testid="consultation-wizard"]')?.dataset.step===value,value);
  const next=()=>page.getByTestId('consult-wizard-actions').getByRole('button',{name:'Continue',exact:true}).click();
  await step('project');await next();assert.equal(await form.getAttribute('data-step'),'project');
  await page.getByTestId('consult-project-looking-for-land').click();await next();await step('name');
  await next();assert.equal(await form.getAttribute('data-step'),'name');
  await page.getByTestId('input-name').fill('Synthetic Navigation Check');await next();await step('prefer');
  await page.getByTestId('button-preferred-contact-email').click();await next();await step('reach');
  await page.getByTestId('input-email').fill('invalid');await next();assert.equal(await form.getAttribute('data-step'),'reach');
  await page.getByTestId('input-email').fill('navigation@example.invalid');await next();await step('review');
  assert.match(await form.innerText(),/Synthetic Navigation Check/);
  assert.match(await form.innerText(),/Still Looking for Land/);
  assert.equal(await page.getByTestId('input-address').count(),0);
  await page.getByTestId('button-add-note').click();
  await page.getByTestId('textarea-message').fill('Synthetic local-only test. '+'LongUnbrokenMaterialSpecification'.repeat(20));
  await page.reload();await step('review');assert.match(await form.innerText(),/Synthetic Navigation Check/);
  const send=page.getByTestId('consult-wizard-actions').getByRole('button').last();
  await send.scrollIntoViewIfNeeded();assert.ok(await send.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'Quote action must be unobstructed');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Quote horizontal overflow');
  // Stop before final Send; caller blocks all external and business requests.
}

export async function verifyConstructionRe10Handoff(page) {
  const destination='https://boisehandyman.co/re-10-repairs-boise';
  assert.equal(await page.getByRole('heading',{level:1}).count(),1);
  assert.match(await page.getByRole('heading',{level:1}).innerText(),/RE-10 repairs in Boise/i);
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),destination);
  const handoff=page.getByRole('link',{name:'Go to Boise Handyman Co',exact:true});
  assert.equal(await handoff.getAttribute('href'),destination);
  await handoff.scrollIntoViewIfNeeded();
  assert.ok(await handoff.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'RE-10 handoff must be unobstructed');
  assert.match(await page.locator('body').innerText(),/handled by Boise Handyman Co/);
  assert.equal(await page.locator('[data-p5-estimator]').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // Inspect the exact public destination without visiting a live second brand.
}
