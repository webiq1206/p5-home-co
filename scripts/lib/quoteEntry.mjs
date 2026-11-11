import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs','construction','boise-construction-co','cabinet','boise-cabinet-co','remodeling','boise-remodeling-co'].includes(brand) ? '/estimate/scope' : '/estimate';
export const isPublicQuotePath = path => path === '/estimate' || path === '/quote' || path.startsWith('/quote/');

/** Exercise the current public quote form without sending a request. The caller
 * supplies a fresh context with all business/third-party traffic blocked.
 * Owner, 1 November (form v2) and 11 November (clarity standard): one short
 * screen that leads the page and shows only what we need to call back: "What
 * can we help with?", name and phone. Email and "How should we reach you?" sit
 * in one closed dropdown; call, text and "Have us call you" stay on the form.
 * Files, project type, address and timing are Step 2, after a request is sent. */
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
  // Field order on the one screen: what we can help with, name, phone, then the optional email. No file field on Step 1.
  assert.deepEqual(await form.evaluate(f=>[...f.querySelectorAll('textarea[name=note],input[type=file],input[name=name],input[name=phone],input[name=email]')].map(el=>el.name||el.type)),['note','name','phone','email']);
  assert.equal(await form.locator('.attach-tile').count(),0,'No attachment tile on Step 1');
  // The steps line names both steps, with step 1 current.
  const steps = form.locator('[data-quote-steps]');
  assert.equal(await steps.getAttribute('data-quote-sent'),'false');
  assert.deepEqual((await steps.locator('li').allInnerTexts()).map(text=>text.replace(/\s+/g,' ').trim()),['1 Step 1: Your request','2 Step 2: Photos and details (optional)']);
  assert.equal(await steps.locator('li[aria-current=step]').count(),1);
  // Everything optional sits in one dropdown, closed on arrival: only the note, name and phone show.
  const options = form.getByTestId('quote-options');
  assert.equal(await options.evaluate(el=>el.tagName+':'+el.open),'DETAILS:false');
  assert.match(await options.locator('summary').innerText(),/^Add an email or choose how we reach you \(optional\)$/);
  assert.equal(await email.isVisible(),false,'Email is hidden until the dropdown is opened');
  assert.equal(await form.getByRole('radio',{name:'Text',exact:true}).isVisible(),false,'Reach choices are hidden until the dropdown is opened');
  assert.deepEqual(await form.evaluate(f=>[...f.querySelectorAll('textarea,input:not([type=hidden]):not([tabindex="-1"]),select')].filter(el=>el.checkVisibility()).map(el=>el.name)),['note','name','phone']);
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
  // The dropdown opens from its summary (a 48px target) and shows email and the reach choices.
  assert.ok((await options.locator('summary').boundingBox()).height>=47.5,'Dropdown summary is 48px tall');
  await options.locator('summary').click();
  assert.equal(await options.evaluate(el=>el.open),true);
  await email.fill('invalid'); await email.blur();
  assert.match(await form.innerText(), /That email address does not look right\./);
  for (const label of ['Call','Text','Email']) assert.equal(await form.getByRole('radio',{name:label,exact:true}).count(),1);
  assert.equal(await form.getByRole('radio',{name:'Text',exact:true}).isChecked(),true,'Text is the default where the site has a text line');
  // Closed again with a bad email inside: sending opens the dropdown and focuses the email, and nothing is sent.
  await options.locator('summary').click();
  assert.equal(await options.evaluate(el=>el.open),false);
  await send.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'email');
  assert.equal(await options.evaluate(el=>el.open),true,'An email error opens the dropdown');
  assert.equal(await email.getAttribute('aria-invalid'),'true');
  // "Email" with no address needs one: the same dropdown opens on send.
  await email.fill('');
  await form.locator('label.quote-form-pill').filter({hasText:/^Email$/}).click();
  await options.locator('summary').click();
  await send.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'email');
  assert.equal(await options.evaluate(el=>el.open),true);
  assert.match(await form.innerText(), /Enter an email address so we can reply by email\./);
  await form.locator('label.quote-form-pill').filter({hasText:/^Text$/}).click();
  await email.fill('navigation@example.invalid');
  // Nothing else on Step 1: the project type travels as a hidden value and is refined in Step 2.
  assert.equal(await form.locator('select[name=project], [name=details_project]').count(),0);
  assert.equal(await form.locator('input[type=hidden][name=project]').count(),1);
  await page.reload(); await page.locator('form#request-form[data-ready]').waitFor();
  assert.equal(await name.inputValue(),'Synthetic Navigation Check');
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // A restored draft that already has an email shows it: the dropdown comes back open.
  assert.equal(await options.evaluate(el=>el.open),true,'A draft with an email reopens the dropdown');
  assert.equal(await email.inputValue(),'navigation@example.invalid');
  // "Send a request" | "Have us call you": the callback side reduces the form to name, phone and a best time, then back.
  const request = form.getByRole('button',{name:'Send a request',exact:true});
  const callback = form.getByRole('button',{name:'Have us call you',exact:true});
  assert.equal(await request.getAttribute('aria-pressed'),'true');
  await callback.click();
  assert.equal(await callback.getAttribute('aria-pressed'),'true');
  assert.equal(await request.getAttribute('aria-pressed'),'false');
  assert.equal(await note.count(),0);
  assert.equal(await form.locator('input[type=file]').count(),0);
  assert.equal(await options.count(),0,'The call-back side has no optional dropdown');
  assert.equal(await form.getByLabel(/^Best time to call/).count(),1);
  assert.equal(await form.getByRole('button',{name:'Request a call',exact:true}).count(),1);
  await request.click();
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // The active tab is marked by an underline, never filled like the send button.
  assert.ok(await request.evaluate((el,sendEl)=>{const tab=getComputedStyle(el),button=getComputedStyle(sendEl);return tab.backgroundColor!==button.backgroundColor&&parseFloat(tab.borderBottomWidth)>=2&&tab.borderBottomColor!==getComputedStyle(el.parentElement.querySelector('[aria-pressed=false]')).borderBottomColor;},await send.elementHandle()),'Active tab must not look like the send button');
  // Call, text and chat stay on the form as one quiet line of links under the send button, each a 48px target.
  assert.equal(await form.locator('a[href^="tel:"]').count(),1);
  assert.equal(await form.locator('a[href^="sms:"]').count(),1);
  assert.equal(await form.getByRole('button',{name:'Chat',exact:true}).count(),1);
  const talkLinks = form.locator('.quote-form-talk-link');
  assert.equal(await talkLinks.count(),3);
  for (const height of await form.locator('.quote-form-talk-link, .quote-form-mode').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height))) assert.ok(height>=47.5,'Contact links and mode tabs are 48px tall');
  assert.ok(await talkLinks.first().evaluate((el,sendEl)=>el.getBoundingClientRect().top>=sendEl.getBoundingClientRect().bottom,await send.elementHandle()),'Call, text and chat sit under the send button');
  assert.equal(await form.locator('button[type=submit]').count(),1,'One send button');
  assert.match(await form.locator('.quote-form-next').innerText(),/^That is all we need\. You can add photos or plans after you send\.$/);
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
  const handoffs=page.getByRole('link',{name:'Go to Boise Handyman Co',exact:true});
  assert.equal(await handoffs.count(),2,'RE-10 hero and sidebar handoffs must both remain available');
  for (const handoff of await handoffs.all()) {
    assert.equal(await handoff.getAttribute('href'),destination);
    await handoff.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    assert.ok(await handoff.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'Each RE-10 handoff must be unobstructed');
  }
  assert.match(await page.locator('body').innerText(),/handled by Boise Handyman Co/);
  assert.equal(await page.locator('[data-p5-estimator]').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // Inspect the exact public destination without visiting a live second brand.
}
