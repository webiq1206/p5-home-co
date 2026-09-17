import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withBrandPageMetadata,BRAND_PAGE_IMAGE} from '../lib/brand-page-metadata.ts';
import type {Metadata} from 'next';
test('page-specific metadata is retained outside authored core-page improvements',()=>{
 const source:Metadata={title:'Oak cabinet finish comparison',description:'Compare the grain and color of oak cabinet finishes.',alternates:{canonical:'/guides/oak-finishes'},openGraph:{type:'article',publishedTime:'2026-09-01'},robots:{index:false,follow:true}};
 const result=withBrandPageMetadata(source,'/guides/oak-finishes');
 assert.deepEqual(result.title,source.title);assert.equal(result.description,source.description);assert.deepEqual(result.alternates,source.alternates);assert.deepEqual(result.robots,source.robots);assert.equal((result.openGraph as any).type,'article');
 assert.equal((result.openGraph as any).images[0].url,BRAND_PAGE_IMAGE);assert.equal((result.twitter as any).images[0],BRAND_PAGE_IMAGE);
});
test('root layout keeps the existing title template and site verification',()=>{
 const source:Metadata={title:{default:'Original homepage',template:'%s | Company'},verification:{google:'existing-verification'},manifest:'/site.webmanifest'};
 const result=withBrandPageMetadata(source,'__layout__');assert.deepEqual(result.title,source.title);assert.deepEqual(result.verification,source.verification);assert.equal(result.manifest,source.manifest);assert.ok(result.icons);
});
test('core descriptions are complete sentences rather than clipped fragments',()=>{
 const result=withBrandPageMetadata({title:'Home',alternates:{canonical:'/'}},'/');
 assert.ok(result.description?.endsWith('.'));assert.ok(!/\b(?:and|with|under|the|one|line-item)\.$/i.test(result.description||''));
});
test('distinct document descriptions remain distinct',()=>{
 const a=withBrandPageMetadata({title:'First guide',description:'One project.'},'/first');const b=withBrandPageMetadata({title:'Second guide',description:'A different project.'},'/second');
 assert.notDeepEqual(a.title,b.title);assert.notEqual(a.description,b.description);
});
