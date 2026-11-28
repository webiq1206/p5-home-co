import test from 'node:test';
import assert from 'node:assert/strict';
import {projectLocality, rank, type Candidate, type Task} from '../app/lib/contractors/match.ts';
const scope=(title:string,rest:Partial<Task>={}):Task=>({id:'a',division:'17',title,...rest});
const person=(id:number,trade:string,keywords:string[],extra:Partial<Candidate>={}):Candidate=>({
  id,company:'Vendor '+id,phone:'2085550101',serviceArea:'Boise, Meridian',capabilities:[{division:'17',trade,keywords,verified:true}],...extra,
});
test('never substitutes generic cabinet, a door supplier, or a mismatched service area for installation',()=>{
  const all=[person(1,'Cabinetry',[]),person(2,'Cabinet door supply',['cabinet doors']),person(3,'Cabinet installation',['cabinet install']),
    person(4,'Cabinet door installation',['cabinet door install'],{serviceArea:'Caldwell'})];
  assert.deepEqual(rank(scope('Supply custom cabinet doors'),all,'boise').map(x=>x.contractor.id),[2]);
  assert.deepEqual(rank(scope('Cabinet installation'),all,'boise').map(x=>x.contractor.id),[3]);
  assert.deepEqual(rank(scope('Install custom cabinet doors'),all,'boise'),[]);
});
test('exact cost code, verified trade, locality, holds, reachability and the top-three cap',()=>{
  const c=scope('Replace damaged finish',{costCode:'17-10-01'});
  const all=[person(1,'Cabinet door repair',['17-10-01']),person(2,'Cabinet door repair',['17-10-01'],{onHold:true}),person(3,'Cabinet door repair',['17-10-01'],{phone:null}),
    person(4,'Cabinet door repair',['17-10-01'],{serviceArea:'Treasure Valley',completedSimilarJobs:4}),
    person(5,'Cabinet door repair',['17-10-01'],{availability:'available',performance:'positive'}),person(6,'Cabinet door repair',['17-10-01'],{performance:'negative'})];
  assert.deepEqual(rank(c,all,'boise').map(x=>x.contractor.id),[5,1,4]);
  assert.deepEqual(rank(c,all,null),[]);
  assert.deepEqual(rank({...c,performer:'internal'},all,'boise'),[]);
});
test('a written postal city is recognized, including Garden City, without matching a street name',()=>{
  assert.equal(projectLocality('21 W Star St, Garden City, ID 83714'),'garden city');
  assert.equal(projectLocality('21 W Boise St, Idaho Falls, ID 83401'),null);
});
test('a finance vendor on compliance hold is not a recommendation',()=>{
  assert.deepEqual(rank(scope('Cabinet installation'),[person(2,'Cabinet installation',[],{qualified:false})],'boise'),[]);
});
