import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {cropSavedPageImage} from '../src/source-image-crop.mjs';

test('saved page fallback crops only the requested normalized source region',async()=>{
 const canvas=createCanvas(100,50),context=canvas.getContext('2d');
 context.fillStyle='red';context.fillRect(0,0,50,50);context.fillStyle='blue';context.fillRect(50,0,50,50);
 const bytes=await cropSavedPageImage(canvas.toBuffer('image/png'),{x:.5,y:0,width:.5,height:1},100);
 const image=await loadImage(bytes);assert.equal(image.width,100);assert.equal(image.height,100);
 const output=createCanvas(100,100),out=output.getContext('2d');out.drawImage(image,0,0);
 const pixel=out.getImageData(50,50,1,1).data;assert.ok(pixel[2]>200&&pixel[0]<20);
});

test('saved page fallback fails closed on an invalid authenticated rendering',async()=>{
 await assert.rejects(cropSavedPageImage(Buffer.from('not-an-image'),{x:0,y:0,width:1,height:1}),/saved-page-crop-failed/);
});