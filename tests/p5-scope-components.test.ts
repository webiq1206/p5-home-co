import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredBuildingComponents,incompatibleBuildingComponent,unsupportedElectricalTask} from '../lib/p5/scopeComponents.ts';
const scope=(text:string,answers:any={})=>({text,answers,extraction:null,uploads:[],corrections:[],reviewedAt:''});
test('a broad new-home task cannot hide a separately measured garage or porch',()=>{
 const input=scope('Build complete home with attached garage and covered porch.',{service:'new-construction',sqft:'2000',garageSqft:'440',coveredOutdoorSqft:'80'});
 const tasks=[{id:'build',description:'Complete house, garage and porch',evidence:input.text}];
 const added=measuredBuildingComponents(input,tasks);
 assert.deepEqual(added.map(t=>t.id),['measured-garageSqft','measured-coveredOutdoorSqft']);
 assert.match(added[1].description,/80 SF covered porch/);
 assert.equal(measuredBuildingComponents(input,[...tasks,...added]).length,0);
 assert.equal(incompatibleBuildingComponent(added[1].description,'Complete house, garage and porch: New home construction (installed price)'),true);
 assert.equal(incompatibleBuildingComponent(added[1].description,'Covered front porch (installed price)'),false);
});
test('zero areas and limited remodels cannot acquire new-building space obligations',()=>{
 assert.equal(measuredBuildingComponents(scope('No garage or porch',{service:'adu',garageSqft:'0',coveredOutdoorSqft:'0'}),[]).length,0);
 assert.equal(measuredBuildingComponents(scope('Paint existing porch',{service:'handyman',coveredOutdoorSqft:'80'}),[]).length,0);
});
test('generic reconnects in selected interior work do not authorize invented electrical device replacement',()=>{
 const task={id:'power',description:'Perform electrical disconnects and reconnects for all replaced fixtures',evidence:'Normal reconnects'};
 const input=scope('Selected interior remodel, not a gut renovation. Replace cabinets, sinks, faucets and toilets. Include reconnects. Exclude full rewiring, HVAC and appliances.',{service:'whole-home'});
 assert.equal(unsupportedElectricalTask(input,task),true);
 assert.equal(unsupportedElectricalTask({...input,text:input.text+' Replace two light fixtures.'},task),false);
 assert.equal(unsupportedElectricalTask(scope('Build a complete new home.',{service:'new-construction'}),task),false);
});
