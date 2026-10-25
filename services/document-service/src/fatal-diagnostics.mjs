// Never return native stderr: document text and paths are untrusted/private.
const patterns=[
 ['javascript-heap-exhausted',/FATAL ERROR: [^\n]{0,160}(?:heap out of memory|Allocation failed)/i],
 ['native-allocation-failed',/(?:std::bad_alloc|cannot allocate memory|failed to allocate|out of memory)/i],
 ['native-assertion-failed',/(?:Assertion [^\n]{0,160}failed|assertion failed)/i],
];
export function fatalDiagnostics(){
 let tail='',remaining=32768,category=null;
 return {write(chunk){
  if(remaining<=0||category)return;
  const value=Buffer.from(chunk).subarray(0,remaining);remaining-=value.length;
  const scan=tail+value.toString('utf8');
  for(const [name,pattern] of patterns)if(pattern.test(scan)){category=name;break;}
  tail=scan.slice(-512);
 },result(){return category||'unclassified';}};
}
export function numericLimits(limits={}){
 return Object.fromEntries(['addressSpaceBytes','bootVmSizeKiB','rssStopKiB','pollMs','bytes'].filter(k=>Number.isFinite(limits[k])&&limits[k]>=0).map(k=>[k,limits[k]]));
}
