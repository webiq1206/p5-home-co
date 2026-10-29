import test from 'node:test';
import assert from 'node:assert/strict';
import {entryRoute,safeEntryEvent,startNavigationDiagnostics,MAX_ENTRY_EVENTS} from '../scripts/lib/navigationDiagnostics.mjs';
test('route diagnostics omit arbitrary paths and query contents',()=>{assert.deepEqual(entryRoute('http://localhost/estimate?review=1&email=private'),{path:'/estimate',review:true});assert.deepEqual(entryRoute('http://localhost/private-customer'),{path:'other',review:false});});
test('event allowlist removes text, URLs, fields and nonfinite values',()=>{assert.deepEqual(safeEntryEvent({kind:'event',type:'click',tag:'A',expectedLink:true,secret:'private',text:'private',url:'private',x:Infinity,link:{x:1,y:2,width:3,height:4,text:'private'}}),{kind:'event',type:'click',expectedLink:true,tag:'A',link:{x:1,y:2,width:3,height:4}});assert.equal(MAX_ENTRY_EVENTS,100);});
test('diagnostics refuse nonlocal targets before touching a browser',async()=>{await assert.rejects(startNavigationDiagnostics(null,null,{base:'https://boisehandyman.co',enabled:true}),/isolated local fixture/);assert.equal(await startNavigationDiagnostics(null,null,{enabled:false}),null);});
