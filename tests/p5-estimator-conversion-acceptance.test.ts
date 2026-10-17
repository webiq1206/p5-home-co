import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completeSubmission} from '../lib/p5/submitProgress.ts';
import {ESTIMATOR_CONVERSION_SEND_TO, finishConversionLabels, finishConversionSendTargets} from '../lib/p5/finishConversion.ts';
import {trackGoogleAdsLeadConversion} from '../lib/googleAdsConversion.ts';

const source = readFileSync(new URL('../components/P5Estimator.tsx', import.meta.url), 'utf8');
const intake = source.slice(source.indexOf('async function submitIntake'), source.indexOf('async function submit('));
const submit = source.slice(source.indexOf('async function submit('), source.indexOf('const continuePaused'));

test('an accepted submit passes accepted true and selects the estimator and form labels', async () => {
  const data = await completeSubmission(async () => Response.json({accepted: true, duplicate: false, id: 'draft-1', result: {range: {low: 1, high: 2}}}), () => {}, async () => {});
  const acceptance = {accepted: data.accepted === true};
  assert.deepEqual(acceptance, {accepted: true});
  assert.deepEqual(finishConversionLabels(acceptance.accepted), ['estimator', 'form']);
  assert.match(submit, /trackGoogleAdsLeadConversion\(\{service:d\.answers\.service\},`estimator:\$\{d\.id\}`,\{accepted:data\.accepted===true\}\)/);
  assert.deepEqual(finishConversionSendTargets('estimator:draft-1', true, 'AW-18354188204/LE2vCPXstO8cEKzf-q9E'), [ESTIMATOR_CONVERSION_SEND_TO, 'AW-18354188204/LE2vCPXstO8cEKzf-q9E']);
  assert.equal(trackGoogleAdsLeadConversion({service: 'kitchen'}, 'estimator:draft-1', acceptance), false);
});

test('a replay with accepted false selects only the estimator label', async () => {
  const data = await completeSubmission(async () => Response.json({accepted: false, duplicate: true, id: 'draft-1', result: {range: {low: 1, high: 2}}}), () => {}, async () => {});
  const acceptance = {accepted: data.accepted === true};
  assert.deepEqual(acceptance, {accepted: false});
  assert.deepEqual(finishConversionLabels(acceptance.accepted), ['estimator']);
  assert.deepEqual(finishConversionSendTargets('estimator:draft-1', false, 'AW-18354188204/LE2vCPXstO8cEKzf-q9E'), [ESTIMATOR_CONVERSION_SEND_TO]);
  assert.match(submit, /\{accepted:data\.accepted===true\}/);
  assert.equal(trackGoogleAdsLeadConversion({service: 'kitchen'}, 'estimator:draft-1', acceptance), false);
});

test('a 409 does not reach the conversion call', async () => {
  await assert.rejects(() => completeSubmission(async () => Response.json({error: 'Save the latest scope before submitting.'}, {status: 409}), () => {}, async () => {}), /Save the latest scope/);
  const trackAt = submit.indexOf('trackGoogleAdsLeadConversion({service:d.answers.service}');
  const catchAt = submit.indexOf('catch(failure)');
  assert.ok(catchAt > 0 && trackAt > catchAt);

  const calls: unknown[] = [];
  const response = Response.json({error: 'Your request was not confirmed.'}, {status: 409});
  const value = await response.json() as {error?: string};
  assert.throws(() => {
    if (!response.ok) throw new Error(value.error || 'Your request was not confirmed. Your work is retained; please retry.');
    calls.push({accepted: true});
  }, /not confirmed/);
  assert.deepEqual(calls, []);
  const throwAt = intake.indexOf('if(!response.ok)throw');
  const intakeTrackAt = intake.indexOf('trackGoogleAdsLeadConversion({service:latest.answers.service},`intake:${receipt.projectId}`,{accepted:receipt.accepted===true})');
  assert.ok(throwAt > 0 && intakeTrackAt > throwAt);
});
