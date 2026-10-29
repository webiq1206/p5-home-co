import assert from 'node:assert/strict';

export const retainedEstimatorPath = brand => ['p5','p5-home-co-nextjs'].includes(brand) ? '/estimate/scope' : '/estimate';
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
