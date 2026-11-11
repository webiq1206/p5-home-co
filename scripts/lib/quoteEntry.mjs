import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs','construction','boise-construction-co','cabinet','boise-cabinet-co','remodeling','boise-remodeling-co'].includes(brand) ? '/estimate/scope' : '/estimate';
export const isPublicQuotePath = path => path === '/estimate' || path === '/quote' || path.startsWith('/quote/');

/** Exercise the current public quote form without sending a request. The caller
 * supplies a fresh context with all business/third-party traffic blocked.
 * Owner, 1 November (form v2) and 11 November (clean layout): one short screen
 * that leads the page and shows only what we need to call back: "What can we
 * help with?", name and phone. Project address, email and "How should we reach you?" sit behind
 * one quiet text toggle; a call link and "Have us call you" share one muted
 * line under the send button. No step indicator, tabs or footnote.
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
  // The whole empty form, heading through send button, fits the first screen.
  assert.ok(await send.evaluate(el=>scrollY<=1&&el.getBoundingClientRect().bottom<=innerHeight),'Heading through send button fit the first screen');
  // Field order on the one screen: what we can help with, name, phone, then the optional address and email. No file field on Step 1.
  assert.deepEqual(await form.evaluate(f=>[...f.querySelectorAll('textarea[name=note],input[type=file],input[name=name],input[name=phone],input[name=address],input[name=email]')].map(el=>el.name||el.type)),['note','name','phone','address','email']);
  assert.equal(await form.locator('.attach-tile').count(),0,'No attachment tile on Step 1');
  // Clean layout: no step indicator, no tabs and no footnote under the button.
  assert.equal(await form.locator('[data-quote-steps], .quote-form-steps, .quote-form-next, [role=tablist]').count(),0,'No step indicator, tabs or footnote');
  // Everything optional sits behind one quiet text toggle, closed on arrival: only the note, name and phone show.
  const options = form.getByTestId('quote-options');
  assert.equal(await options.evaluate(el=>el.tagName+':'+el.open),'DETAILS:false');
  assert.equal(await options.locator('summary').evaluate(el=>el.textContent.replace(/\s+/g,' ').trim()),'Add address, email or contact preference (optional)');
  // A line of text, not a box: no border, background or shadow on the toggle or its summary.
  assert.ok(await options.evaluate(el=>[el,el.querySelector('summary')].every(node=>{const c=getComputedStyle(node);return parseFloat(c.borderTopWidth)+parseFloat(c.borderBottomWidth)+parseFloat(c.borderLeftWidth)+parseFloat(c.borderRightWidth)===0&&c.backgroundColor==='rgba(0, 0, 0, 0)'&&c.boxShadow==='none';})),'The optional toggle must not be boxed');
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
  // Name and phone share a row from 640px up and stack below it.
  assert.equal(await form.evaluate(f=>{const n=f.querySelector('input[name=name]').getBoundingClientRect(),p=f.querySelector('input[name=phone]').getBoundingClientRect();return Math.abs(n.top-p.top)<1&&p.left>=n.right;}),await page.evaluate(()=>innerWidth>=640),'Name and phone side by side from 640px');
  // The toggle opens from its summary (a 48px target) and shows email and the reach choices inline.
  assert.ok((await options.locator('summary').boundingBox()).height>=47.5,'Toggle summary is 48px tall');
  await options.locator('summary').click();
  assert.equal(await options.evaluate(el=>el.open),true);
  // The optional project address leads the opened toggle: never required, with a plain hint for new builds.
  const address = form.getByLabel('Project address',{exact:true});
  assert.equal(await address.evaluate(el=>[el.name,el.type,el.getAttribute('autocomplete'),el.required,el.maxLength].join('|')),'address|text|street-address|false|300');
  assert.equal(await address.evaluate(el=>document.getElementById(el.getAttribute('aria-describedby')).textContent.replace(/\s+/g,' ').trim()),'Leave blank if you do not have one yet.');
  assert.equal(await form.locator('.quote-form-hint').isVisible(),true);
  assert.ok(await address.evaluate((el,emailEl)=>el.getBoundingClientRect().bottom<=emailEl.getBoundingClientRect().top,await email.elementHandle()),'Address sits above email');
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
  // An address alone, with the default reach and no email, also reopens the toggle after a reload.
  await address.fill('412 N Synthetic St');
  await page.reload(); await page.locator('form#request-form[data-ready]').waitFor();
  assert.equal(await options.evaluate(el=>el.open),true,'A draft with an address reopens the toggle');
  assert.equal(await address.inputValue(),'412 N Synthetic St');
  assert.equal(await email.inputValue(),'');
  await address.fill('');
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
  // "Send a request" | "Have us call you": the same two toggle buttons, now one muted line under the send
  // button. Only the one for the other mode shows, as a text link; the active one stays pressed but hidden.
  const request = form.getByRole('button',{name:'Send a request',exact:true});
  const callback = form.getByRole('button',{name:'Have us call you',exact:true});
  const shown = button => button.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&r.left>=0;});
  // The sentence as a sighted visitor reads it: the hidden, pressed button left out.
  const talkLine = () => form.locator('.quote-form-talk').evaluate(el=>{const copy=el.cloneNode(true);copy.querySelector('[aria-pressed=true]').remove();return copy.textContent.replace(/\s+/g,' ').trim();});
  assert.equal(await request.getAttribute('aria-pressed'),'true');
  assert.equal(await shown(request),false,'The active mode is not shown as a control');
  assert.equal(await shown(callback),true);
  assert.match(await talkLine(),/^Prefer to talk\? Call \(\d{3}\) \d{3}-\d{4} or have us call you\.$/i);
  assert.ok(await callback.evaluate((el,sendEl)=>{const link=getComputedStyle(el);return link.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(link.borderTopWidth)===0&&link.textDecorationLine.includes('underline')&&el.getBoundingClientRect().top>=sendEl.getBoundingClientRect().bottom;},await send.elementHandle()),'"Have us call you" is a text link under the send button');
  await callback.click();
  assert.equal(await callback.getAttribute('aria-pressed'),'true');
  assert.equal(await request.getAttribute('aria-pressed'),'false');
  assert.equal(await shown(request),true);
  assert.equal(await shown(callback),false);
  assert.match(await talkLine(),/^Rather write it down\? Send a request$/);
  assert.equal(await note.count(),0);
  assert.equal(await form.locator('input[type=file]').count(),0);
  assert.equal(await options.count(),0,'The call-back side has no optional dropdown');
  assert.equal(await form.getByLabel(/^Best time to call/).count(),1);
  assert.equal(await form.getByRole('button',{name:'Request a call',exact:true}).count(),1);
  await request.click();
  assert.match(await note.inputValue(),/Synthetic navigation check/);
  // One call link on the form, and no text or chat link: the header and the bottom bar carry those.
  assert.equal(await form.locator('a[href^="tel:"]').count(),1);
  assert.equal(await form.locator('a[href^="sms:"]').count(),0);
  assert.equal(await form.getByRole('button',{name:'Chat',exact:true}).count(),0);
  for (const height of await form.locator('a[href^="tel:"], .quote-form-mode[aria-pressed=false], .quote-form-legal a').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height))) assert.ok(height>=47.5,'Call, mode and privacy links are 48px targets');
  assert.equal(await form.locator('button[type=submit]').count(),1,'One send button');
  // After the button: the call line, then "No obligation." with the privacy link, and nothing else.
  assert.deepEqual(await send.evaluate(el=>{const out=[];for(let n=el.nextElementSibling;n;n=n.nextElementSibling)if(n.checkVisibility())out.push(n.textContent.replace(/\s+/g,' ').trim().replace(/\(\d{3}\) \d{3}-\d{4}/,'PHONE'));return out;}),['Prefer to talk? Call PHONE or Send a requestHave us call you.','No obligation. Privacy Policy']);
  assert.equal(await form.locator('.quote-form-legal a').getAttribute('href'),'/legal/privacy');
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
  // Clarity standard (owner, 11 November): files move to Step 2, and the optional fields sit in one closed dropdown.
  assert.equal(await page.getByTestId('input-files').count(),0,'No attachment tile before the request is sent');
  const options=page.getByTestId('quote-options');
  assert.equal(await options.evaluate(el=>el.open),false,'Optional fields are closed on arrival');
  const send=page.getByTestId('button-send-request');
  await page.locator('[data-testid="button-send-request"][data-hydrated="true"]').waitFor();
  await send.click();await focused('textarea-message');
  assert.equal(await form.getAttribute('data-step'),'project','Empty send is blocked');
  await message.fill('Synthetic local-only test. '+'LongUnbrokenMaterialSpecification'.repeat(20));
  await page.getByTestId('input-name').fill('Synthetic Navigation Check');
  await page.getByTestId('input-phone').fill('2085550102');
  await options.locator('summary').click();
  // The optional project address leads the toggle (owner, 11 November): a new build often has none yet.
  assert.equal(await options.getByTestId('input-project-address').evaluate(el=>el===el.closest('details').querySelector('input,select,textarea')&&el.getAttribute('aria-required')!=='true'&&!el.required),true,'Optional project address is the first field in the toggle');
  await page.getByTestId('button-preferred-contact-email').click();
  await page.getByTestId('input-email').fill('invalid');
  await send.click();await focused('input-email');
  assert.equal(await form.getAttribute('data-step'),'project','Invalid email blocks the send');
  await page.getByTestId('input-email').fill('navigation@example.invalid');
  await page.reload();await form.waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="input-name"]')?.value==='Synthetic Navigation Check');
  assert.match(await message.inputValue(),/Synthetic local-only test/);
  assert.equal(await page.getByTestId('input-email').inputValue(),'navigation@example.invalid');
  assert.equal(await options.evaluate(el=>el.open),true,'A restored email reopens the optional dropdown');
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
