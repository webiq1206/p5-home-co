"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {P5Estimator} from './P5Estimator';
import type {QaSavedEstimateView,SavedEstimatePreview} from '@/lib/p5/qaSavedEstimateView';

const endpoint=(revision:number,pdf=false)=>`/api/admin/p5-estimators/qa-saved-estimate?case=case-1&revision=${revision}${pdf?'&pdf=1':''}`;
async function savedResponse(revision:number,pdf=false,signal?:AbortSignal){
  const response=await fetch(endpoint(revision,pdf),{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(typeof body?.error==='string'?body.error:'The saved synthetic estimate could not be verified.');}
  return response;
}
/** This adapter reads one fixed saved case. It has no ordinary draft transport,
 * browser persistence, provider operation, contact action or retry loop. */
export default function P5QaSavedEstimate({revision}:{revision:6}){
  const [view,setView]=useState<QaSavedEstimateView|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void savedResponse(revision,false,controller.signal).then(response=>response.json()).then((next:QaSavedEstimateView)=>{
      if(controller.signal.aborted)return;
      if(next.case!=='case-1'||next.revision!==revision||!next.result||!next.document||!next.delivery?.length||next.delivery.some(row=>row.channel!=='suppressed'||row.status!=='suppressed'))throw new Error('The saved synthetic estimate identity could not be verified.');
      setError('');setView(next);
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'The saved estimate could not be opened.');});
    return()=>controller.abort();
  },[revision,reload]);
  const restore=useCallback(()=>{setView(null);setError('');setReload(value=>value+1);},[]);
  const preview=useMemo<SavedEstimatePreview|null>(()=>view?.revision===revision?{view,restore,downloadPdf:async()=>{
    const response=await savedResponse(view.revision,true);return response.blob();
  }}:null,[view,revision,restore]);
  if(!preview)return <main style={{padding:'2rem',maxWidth:640,margin:'auto'}}><h1>Saved synthetic QA estimate</h1>{error?<><p role="alert">{error}</p><button type="button" onClick={restore}>Read saved estimate again</button><p><a href="/admin/login">Administrator sign-in</a></p></>:<p role="status">Reading the saved estimate. No generation or delivery is started.</p>}</main>;
  return <main style={{minWidth:0,minHeight:'100dvh'}}><P5Estimator key={`case-1:${preview.view.revision}:${reload}`} layout="page" savedPreview={preview}/></main>;
}
