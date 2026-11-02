import test from 'node:test';
import assert from 'node:assert/strict';
import {fatalDiagnostics,numericLimits} from '../src/fatal-diagnostics.mjs';
test('only fatal categories survive split synthetic stderr',()=>{
 const d=fatalDiagnostics();d.write(Buffer.from('private synthetic address FATAL ERROR: Reached heap limit Allocation '));d.write(Buffer.from('failed - JavaScript heap out of memory secret'));assert.equal(d.result(),'javascript-heap-exhausted');assert.ok(!JSON.stringify(d).includes('private'));
});
test('unknown stderr is never exposed',()=>{const d=fatalDiagnostics();d.write('synthetic@example.test /private/file.pdf');assert.equal(d.result(),'unclassified');});
test('scan is bounded and drains later input without retaining it',()=>{const d=fatalDiagnostics();d.write(Buffer.alloc(32768,120));d.write('std::bad_alloc');assert.equal(d.result(),'unclassified');});
test('native allocation and assertion have distinct categories',()=>{for(const [input,want] of [['std::bad_alloc','native-allocation-failed'],['Assertion example failed','native-assertion-failed']]){const d=fatalDiagnostics();d.write(input);assert.equal(d.result(),want);}});
test('limits allow only nonnegative finite numeric fields',()=>{assert.deepEqual(numericLimits({addressSpaceBytes:123,bootVmSizeKiB:20,rssStopKiB:320,pollMs:20,bytes:Infinity,secret:'hidden',path:'/private'}),{addressSpaceBytes:123,bootVmSizeKiB:20,rssStopKiB:320,pollMs:20});});
