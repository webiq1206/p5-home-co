import {createCanvas,loadImage} from '@napi-rs/canvas';
import {ServiceError} from './core.mjs';

/** Crop the already authenticated, durable page rendering when PDF rerendering
 * crashes. This cannot add detail, so callers must label it as a saved-image
 * fallback and let verification retain uncertainty where it is insufficient. */
export async function cropSavedPageImage(bytes,region,maxEdge=2000){
 try{
  const image=await loadImage(Buffer.from(bytes));
  const sx=Math.floor(image.width*region.x),sy=Math.floor(image.height*region.y);
  const sw=Math.max(1,Math.ceil(image.width*region.width)),sh=Math.max(1,Math.ceil(image.height*region.height));
  const scale=Math.min(3,maxEdge/Math.max(sw,sh)),width=Math.max(1,Math.ceil(sw*scale)),height=Math.max(1,Math.ceil(sh*scale));
  const canvas=createCanvas(width,height);
  canvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,width,height);
  return canvas.toBuffer('image/png');
 }catch{throw new ServiceError('saved-page-crop-failed',503);}
}