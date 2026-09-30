import test from 'node:test';
import assert from 'node:assert/strict';
import {computedProjectQuantity,validateProjectQuantities} from '../lib/p5/projectRecord.ts';
import {projectUnit,sourceNumbers} from '../lib/p5/projectUnits.ts';
import type {ProjectQuantityValue} from '../lib/p5/projectRecordContracts.ts';
const quantity=(id:string,value:number,unit:string):ProjectQuantityValue=>({id,description:id,value,unit,basis:'stated',range:null,evidenceIds:[],calculation:null,assumption:''});
const calculation=(id:string,value:number,unit:string,operation:'sum'|'difference'|'product'|'ratio',inputs:string[]):ProjectQuantityValue=>({...quantity(id,value,unit),basis:'calculated',calculation:{operation,inputIds:inputs,factor:1}});
test('dimensional quantities cover cubic concrete and net areas without project-specific formulas',()=>{
 const dimensions=[quantity('length',12,'FT'),quantity('width',9,'FT'),quantity('depth',6,'in')];
 const volume=calculation('volume',2,'CY','product',dimensions.map(q=>q.id));
 assert.equal(computedProjectQuantity(volume,[...dimensions,volume]),2);
 const gross=quantity('gross',144,'SF'),opening=quantity('opening',2,'SY'),net=calculation('net',126,'SF','difference',['gross','opening']);
 assert.equal(computedProjectQuantity(net,[gross,opening,net]),126);
 assert.equal(computedProjectQuantity({...net,unit:'LF'},[gross,opening,net]),null);
 assert.equal(computedProjectQuantity({...net,calculation:{...net.calculation!,inputIds:['opening','gross']}},[gross,opening,net]),null);
});
test('explicit coverage units produce a purchase count without treating a box as one installed item',()=>{
 const area=quantity('area',200,'SF'),coverage=quantity('coverage',20,'SF/box'),boxes=calculation('boxes',10,'box','ratio',['area','coverage']);
 assert.equal(computedProjectQuantity(boxes,[area,coverage,boxes]),10);
 assert.equal(computedProjectQuantity({...boxes,unit:'EA'},[area,coverage,boxes]),null);
 assert.equal(computedProjectQuantity(boxes,[area,{...coverage,unit:'SF'},boxes]),null);
 const packages=quantity('packages',4,'box'),contents=quantity('contents',6,'EA/box'),pieces=calculation('pieces',24,'EA','product',['packages','contents']);
 assert.equal(computedProjectQuantity(pieces,[packages,contents,pieces]),24);
});
test('a labor day never silently becomes eight hours and unknown compound units stay unsupported',()=>{
 const day=quantity('day',1,'day'),hours=calculation('hours',8,'HR','sum',['day']);
 assert.equal(computedProjectQuantity(hours,[day,hours]),null);
 assert.equal(projectUnit('widgets/unicorn'),null);assert.equal(projectUnit('SF/HR/EA'),null);
});
test('fractional source dimensions retain supported values and zero physical quantities are permitted',()=>{
 const values=sourceNumbers('Thickness 1/2 inch; width 24-3/4 inches; edge ½ inch; 1,800 SF; no extra pieces: 0.');
 assert.ok(sourceNumbers('1½ inches').includes(1.5));assert.ok(values.includes(.5));assert.ok(values.includes(24.75));assert.ok(values.includes(1800));
 const zero={...quantity('excluded',0,'EA'),evidenceIds:['e1']};
 assert.deepEqual(validateProjectQuantities([zero],[{id:'e1',sourceId:'s1',quote:'No extra pieces: 0.'}]),[]);
});
