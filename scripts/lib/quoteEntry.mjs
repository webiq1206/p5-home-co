import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs','construction','boise-construction-co'].includes(brand) ? '/estimate/scope' : '/estimate';
export const isPublicQuotePath = path => path === '/estimate' || path === '/quote' || path.startsWith('/quote/');

/** Exercise the current public wizard without sending a request. The caller
 * supplies a fresh context with all business/third-party traffic blocked. */
export async function verifyQuoteEntry(page, path) {
  if (path === '/estimate') assert.equal(new URL(page.url()).pathname, '/quote');
  const form = page.locator('form#request-form');
  await form.waitFor();
  await page.waitForFunction(() => ['category','match'].includes(document.querySelector('form#request-form')?.dataset.wizardStep));
  const step = async value => page.waitForFunction(value => document.querySelector('form#request-form')?.dataset.wizardStep === value, value);
  const advance = async value => { await form.getByRole('button', {name:/^(Next|Continue)$/}).click(); await step(value); };
  if (await form.getAttribute('data-wizard-step') === 'category') {
    assert.equal(await form.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    await form.getByRole('button',{name:'Repairs or handyman',exact:true}).click();
    await advance('match');
    assert.match(await form.getByRole('status').innerText(), /Boise Handyman Co/);
  } else {
    assert.ok((await form.getByRole('status').innerText()).includes('Co'));
  }
  await advance('note');
  const note = form.getByLabel('What should we know?',{exact:true});
  assert.equal(await form.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
  await note.fill('Synthetic navigation check. '+ 'LongUnbrokenMaterialSpecification'.repeat(20));
  await advance('contact');
  assert.equal(await form.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
  await form.getByLabel('Name',{exact:true}).fill('Synthetic Navigation Check');
  await advance('phone');
  assert.equal(await form.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
  await form.getByLabel('Phone',{exact:true}).fill('2085550102');
  await advance('email');
  await form.getByLabel('Email',{exact:true}).fill('invalid');
  assert.equal(await form.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
  await form.getByLabel('Email',{exact:true}).fill('navigation@example.invalid');
  await advance('review');
  assert.match(await form.innerText(), /Synthetic Navigation Check/);
  assert.equal(await form.locator('input[type=file]').count(),1);
  await page.reload(); await step('review');
  assert.match(await form.innerText(), /Synthetic Navigation Check/);
  const send=form.getByRole('button',{name:'Request a quote',exact:true});
  await send.scrollIntoViewIfNeeded();
  assert.ok(await send.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}), 'Quote action must be unobstructed');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Quote horizontal overflow');
  // Deliberately stop before submission: no synthetic contact reaches a server.
}

export const isConstruction = brand => ['construction','boise-construction-co'].includes(brand);

/** Public Construction wizard, separate from the retained typed estimator. */
export async function verifyConstructionEntry(page, path) {
  if(path==='/' || path==='/#calculator'){
    await page.locator('a[href="/estimate"]').first().click();
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
