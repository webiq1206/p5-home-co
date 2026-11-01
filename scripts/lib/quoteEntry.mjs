import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs','construction','boise-construction-co','cabinet','boise-cabinet-co','remodeling','boise-remodeling-co'].includes(brand) ? '/estimate/scope' : '/estimate';
export const isPublicQuotePath = path => path === '/estimate' || path === '/quote' || path.startsWith('/quote/');

/** Exercise the current public quote form without sending a request. The caller
 * supplies a fresh context with all business/third-party traffic blocked.
 * Owner, 1 November (form v2): one short screen that leads the page and opens
 * with "What can we help with?", then one attachment tile, name and phone;
 * call, text and "Have us call you" on the form itself. Project type, address
 * and timing are Step 2, after a request is sent. */
export async function verifyQuoteEntry(page, path) {
  if (path === '/estimate') assert.equal(new URL(page.url()).pathname, '/quote');
  const form = page.locator('form#request-form');
  await form.waitFor();
  await page.locator('form#request-form[data-ready]').waitFor();
  const note = form.getByLabel('What can we help with?',{exact:true});
  // The form leads the page: its heading and first field are on the first screen, under the sticky header.
  assert.ok(await note.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.querySelector('[data-family-header]')?.getBoundingClientRect().bottom??0,t=el.form.querySelector('h2').getBoundingClientRect();return scrollY<=1&&t.top>=h-1&&r.bottom<=innerHeight;}),'Quote heading and first field must be on the first screen');
  assert.equal(await page.evaluate(()=>document.activeElement?.matches('input,textarea,select')??false),false,'No field takes focus on arrival');
  const name = form.getByLabel('Name',{exact:true});
  const phone = form.getByLabel('Phone',{exact:true});
  const email = form.locator('input[name="email"]');
  const send = form.getByRole('button',{name:'Send my request',exact:true});
  // Field order on the one screen: what we can help with, the tile, name, phone, email.
  assert.deepEqual(await form.evaluate(f=>[...f.querySelectorAll('textarea[name=note],input[type=file],input[name=name],input[name=phone],input[name=email]')].map(el=>el.name||el.type)),['note','files','name','phone','email']);
  // An empty send names each problem in plain words and focuses the first one; nothing is sent.
  await send.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'note');
  assert.equal(await note.getAttribute('aria-invalid'),'true');
  const errors = await form.innerText();
  for (const message of [/Tell us a little about what you need\./,/Enter your name\./,/Enter a phone number so we can reach you\./]) assert.match(errors, message);
  await note.fill('Synthetic navigation check. '+ 'LongUnbrokenMaterialSpecification'.repeat(20));
  assert.equal(await note.getAttribute('aria-invalid'),null);
  await name.fill('Synthetic Navigation Check');
  assert.equal(await name.getAttribute('aria-invalid'),null);
  await phone.fill('123'); await phone.blur();
  assert.equal(await phone.getAttribute('aria-invalid'),'true');
  await phone.fill('2085550102');
  assert.equal(await phone.getAttribute('aria-invalid'),null);
  assert.equal(await phone.getAttribute('type'),'tel');
  await email.fill('invalid'); await email.blur();
  assert.match(await form.innerText(), /That email address does not look right\./);
  await email.fill('navigation@example.invalid');
  // One friendly attachment tile, not the raw file control: the native input is visually hidden behind it.
  const file = form.locator('input[type=file]');
  assert.equal(await file.count(),1);
  assert.equal(await file.getAttribute('accept'),'image/*,application/pdf,.heic,.heif');
  assert.equal(await file.getAttribute('multiple'),'');
  assert.match(await form.locator('.attach-tile').innerText(),/Add photos, plans or files \(optional\)[\s\S]*Up to 10 files, 20 MB each\./);
  assert.ok((await form.locator('.attach-tile').boundingBox()).height>=56,'Attachment tile is at least 56px tall');
  for (const label of ['Call','Text','Email']) assert.equal(await form.getByRole('radio',{name:label,exact:true}).count(),1);
  assert.equal(await form.getByRole('radio',{name:'Text',exact:true}).isChecked(),true,'Text is the default where the site has a text line');
  // Nothing else on Step 1: the project type travels as a hidden value and is refined in Step 2.
  assert.equal(await form.locator('select[name=project], [name=details_project]').count(),0);
  assert.equal(await form.locator('input[type=hidden][name=project]').count(),1);
  await page.reload(); await page.locator('form#request-form[data-ready]').waitFor();
  assert.equal(await name.inputValue(),'Synthetic Navigation Check');
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // "Send a request" | "Have us call you": the callback side reduces the form to name, phone and a best time, then back.
  const request = form.getByRole('button',{name:'Send a request',exact:true});
  const callback = form.getByRole('button',{name:'Have us call you',exact:true});
  assert.equal(await request.getAttribute('aria-pressed'),'true');
  await callback.click();
  assert.equal(await callback.getAttribute('aria-pressed'),'true');
  assert.equal(await request.getAttribute('aria-pressed'),'false');
  assert.equal(await note.count(),0);
  assert.equal(await form.locator('input[type=file]').count(),0);
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

/** Public Construction quote form (v2, owner 1 November): one screen led by "What can we help with?",
 * project type and address moved to Step 2. Separate from the retained typed estimator. */
export async function verifyConstructionEntry(page, path) {
  if(path==='/' || path==='/#calculator'){
    await page.locator('a[href="/estimate"]:visible').first().click();
    await page.waitForURL(url=>url.pathname==='/estimate');
  }
  const form=page.getByTestId('consultation-wizard');
  const focused=id=>page.waitForFunction(id=>document.activeElement?.getAttribute('data-testid')===id,id,{timeout:5000});
  await form.waitFor();
  assert.equal(await form.getAttribute('data-step'),'project');
  assert.equal(await page.getByTestId('consult-wizard-actions').count(),0,'Step 1 is one screen, no Continue');
  const message=page.getByTestId('textarea-message');
  assert.ok(await message.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'First field visible on arrival');
  for(const id of ['input-address','consult-project-looking-for-land']) assert.equal(await page.getByTestId(id).count(),0,id+' belongs to step 2');
  assert.equal(await page.getByTestId('input-files').getAttribute('accept'),'image/*,application/pdf,.heic,.heif');
  const send=page.getByTestId('button-send-request');
  await page.locator('[data-testid="button-send-request"][data-hydrated="true"]').waitFor();
  await send.click();await focused('textarea-message');
  assert.equal(await form.getAttribute('data-step'),'project','Empty send is blocked');
  await message.fill('Synthetic local-only test. '+'LongUnbrokenMaterialSpecification'.repeat(20));
  await page.getByTestId('input-name').fill('Synthetic Navigation Check');
  await page.getByTestId('input-phone').fill('2085550102');
  await page.getByTestId('button-preferred-contact-email').click();
  await page.getByTestId('input-email').fill('invalid');
  await send.click();await focused('input-email');
  assert.equal(await form.getAttribute('data-step'),'project','Invalid email blocks the send');
  await page.getByTestId('input-email').fill('navigation@example.invalid');
  await page.reload();await form.waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="input-name"]')?.value==='Synthetic Navigation Check');
  assert.match(await message.inputValue(),/Synthetic local-only test/);
  assert.equal(await page.getByTestId('input-email').inputValue(),'navigation@example.invalid');
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
