import {cleanText} from './core.mjs';
export const SPAN_COORDINATES='viewport-top-left-v1';

/** PDF user coordinates can have a nonzero/negative crop-box origin and page
 * rotation. Map the full text rectangle through the page viewport. */
export function viewportSpan(item,viewport){
 const [a,b,c,d,x,y]=item.transform,along=Math.hypot(a,b)||1,up=Math.hypot(c,d)||1;
 const dx=a/along*Math.abs(item.width),dy=b/along*Math.abs(item.width),hx=c/up*Math.abs(item.height),hy=d/up*Math.abs(item.height);
 const points=[[x,y],[x+dx,y+dy],[x+hx,y+hy],[x+dx+hx,y+dy+hy]].map(([px,py])=>viewport.convertToViewportPoint(px,py));
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 return {text:item.str,x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}

/** Exact text anchors locate a label, not its meaning or association. Supply a
 * bounded surrounding crop so the independent verifier can see that context. */
export function textAnchorRegions(record,native,limit=4){
 if(limit<=0)return [];
 if(native.spanCoordinates!==SPAN_COORDINATES||!(native.width>0&&native.height>0))return [];
 const regions=[],seen=new Set();
 for(const item of [...record.facts,...record.items]){
  const quote=cleanText(item.evidence);
  if(item.basis!=='uncertain'||quote.length<3||quote.length>60||seen.has(quote))continue;
  const matches=native.spans.filter(s=>cleanText(s.text)===quote);
  if(matches.length!==1)continue;
  const span=matches[0],cx=(span.x+span.width/2)/native.width,cy=(span.y+span.height/2)/native.height;
  if(cx<0||cx>1||cy<0||cy>1)continue;
  const width=Math.min(1,Math.max(.16,span.width/native.width+.08)),height=Math.min(1,Math.max(.14,span.height/native.height+.08));
  regions.push({x:Math.max(0,Math.min(1-width,cx-width/2)),y:Math.max(0,Math.min(1-height,cy-height/2)),width,height,reason:`Exact text anchor for ${quote}; surrounding context must be verified independently.`});
  seen.add(quote);if(regions.length>=limit)break;
 }
 return regions;
}
