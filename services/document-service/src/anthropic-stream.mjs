import {ServiceError} from './core.mjs';

const MAX_BYTES=8*1024*1024;

/** A live stream gets an idle deadline AND an absolute deadline. Pings can keep
 * a connection active, but cannot extend the absolute bound. */
export function responseDeadline(parent,idleMs,totalMs){
 const controller=new AbortController();let idle;
 const abort=()=>controller.abort(parent.reason);
 const touch=()=>{clearTimeout(idle);if(!controller.signal.aborted)idle=setTimeout(()=>controller.abort(new ServiceError('provider-idle-timeout',503)),idleMs);};
 const total=setTimeout(()=>controller.abort(new ServiceError('provider-total-timeout',503)),totalMs);
 if(parent.aborted)abort();else parent.addEventListener('abort',abort,{once:true});
 touch();
 return {signal:controller.signal,touch,close(){clearTimeout(idle);clearTimeout(total);parent.removeEventListener('abort',abort);}};
}

/** Consume bounded SSE and reconstruct the ordinary Messages response. Partial
 * usage is diagnostic only: a truncated stream is never a completed response. */
export async function collectAnthropicResponse(response,{signal,onProgress=()=>{}}={}){
 signal?.throwIfAborted();
 const streaming=/text\/event-stream/i.test(response.headers.get('content-type')||'');
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new ServiceError('provider-response-too-large',422);
 if(!response.body)throw new ServiceError('provider-empty-response',422);
 const reader=response.body.getReader(),decoder=new TextDecoder();
 const progress={streaming,requestId:response.headers.get('request-id')||null,bytes:0,events:0,textCharacters:0,toolCharacters:0,complete:false};
 const blocks=new Map();let message=null,stopped=false,deltaSeen=false,buffer='',plain='';
 let rejectAbort;
 const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
 const abort=()=>{rejectAbort(signal.reason);void reader.cancel(signal.reason).catch(()=>{});};
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const fail=(reason='event-order')=>{progress.failure={reason,event:progress.lastEvent||null};onProgress(structuredClone(progress));throw new ServiceError('provider-invalid-stream',422);};
 const event=frame=>{
  const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data)return;
  let value;try{value=JSON.parse(data);}catch{fail('event-json');}
  if(!value||typeof value.type!=='string')fail();
  progress.events++;progress.lastEvent=value.type;
  if(stopped)fail();
  switch(value.type){
   case 'ping':break;
   case 'error':throw new ServiceError(value.error?.type==='overloaded_error'?'provider-overloaded':'provider-stream-error',503);
   case 'message_start':
    if(message||value.message?.type!=='message'||!Array.isArray(value.message.content)||value.message.content.length)fail();
    message={...value.message,content:[],usage:{...value.message.usage}};break;
   case 'content_block_start':{
    if(!message||deltaSeen||!Number.isSafeInteger(value.index)||value.index<0||blocks.has(value.index)||value.index!==blocks.size)fail();
    const block=value.content_block;
    if(!block||!['text','tool_use','thinking','redacted_thinking'].includes(block.type))fail();
    blocks.set(value.index,{block:structuredClone(block),json:'',closed:false});break;
   }
   case 'content_block_delta':{
    const saved=blocks.get(value.index),d=value.delta;if(!saved||saved.closed||deltaSeen||!d)fail();
    if(d.type==='text_delta'&&saved.block.type==='text'&&typeof d.text==='string'){saved.block.text=(saved.block.text||'')+d.text;progress.textCharacters+=d.text.length;}
    else if(d.type==='input_json_delta'&&saved.block.type==='tool_use'&&typeof d.partial_json==='string'){saved.json+=d.partial_json;progress.toolCharacters+=d.partial_json.length;}
    // Thinking is not needed for domain parsing and is never logged.
    else if(['thinking_delta','signature_delta'].includes(d.type)){if(saved.block.type!=='thinking')fail('delta-block-mismatch');}
    else if(['text_delta','input_json_delta'].includes(d.type))fail('delta-block-mismatch');
    else progress.unknownDeltaTypes=[...new Set([...(progress.unknownDeltaTypes||[]),String(d.type).slice(0,80)])].slice(0,16);
    break;
   }
   case 'content_block_stop':{
    const saved=blocks.get(value.index);if(!saved||saved.closed)fail();
    // A tool may stop midway through JSON at max_tokens. Keep consuming the
    // stream for its final stop reason and usage; incomplete input is NEVER
    // promoted into a usable tool call. Domain parsing rejects the raw string.
    if(saved.block.type==='tool_use'&&saved.json){try{saved.block.input=JSON.parse(saved.json);}catch{saved.block.input=saved.json;progress.invalidToolJson=true;}}
    saved.closed=true;break;
   }
   case 'message_delta':
     // Anthropic may deliver terminal message metadata before the final
     // content_block_stop. Defer completion until that block closes. No later
     // content delta is accepted, and message_stop still requires all blocks.
     if(!message)fail();
    deltaSeen=true;Object.assign(message,value.delta);message.usage={...message.usage,...value.usage};progress.stopReason=message.stop_reason;break;
   case 'message_stop':
    if(!message||!deltaSeen||!message.stop_reason||[...blocks.values()].some(b=>!b.closed))fail();
    message.content=[...blocks.values()].map(b=>b.block);stopped=true;progress.complete=true;break;
   default:break; // Future event types do not turn an incomplete message complete.
  }
  if(message?.usage)progress.observedUsage={...message.usage};
  onProgress(structuredClone(progress));
 };
 try{
  onProgress(structuredClone(progress));
  for(;;){
   signal?.throwIfAborted();
   const {done,value}=await Promise.race([reader.read(),aborted]);if(done)break;
   progress.bytes+=value.byteLength;if(progress.bytes>MAX_BYTES)throw new ServiceError('provider-response-too-large',422);
   const chunk=decoder.decode(value,{stream:true});
   if(streaming){
    buffer+=chunk;
    // Preserve a trailing CR until the next chunk, including split CRLF pairs.
    buffer=buffer.replace(/\r\n/g,'\n').replace(/\r(?!$)/g,'\n');
    let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);event(frame);}
   }else plain+=chunk;
   onProgress(structuredClone(progress));
   if(stopped){await reader.cancel();break;}
  }
  signal?.throwIfAborted();
  if(streaming){if(!stopped)throw new ServiceError('provider-stream-incomplete',503);return JSON.stringify(message);}
  plain+=decoder.decode();return plain;
 }finally{signal?.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
