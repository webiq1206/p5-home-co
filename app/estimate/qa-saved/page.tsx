import type {Metadata} from 'next';
import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {DraftError} from '@/lib/p5/store';
import P5QaSavedEstimate from '@/components/P5QaSavedEstimate';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:{absolute:'Saved synthetic estimate QA'},robots:{index:false,follow:false,noarchive:true}};
/** Private entry only; deliberately absent from public navigation and inventory. */
export default async function SavedQaEstimatePage({searchParams}:{searchParams:Promise<{case?:string;revision?:string}>}){
  try{await requireEstimatorAdmin();}
  catch(error){if(error instanceof DraftError&&error.status===403)return <main><h1>Saved synthetic estimate QA</h1><p>Administrator sign-in is required.</p><a href="/admin/login">Sign in</a></main>;throw error;}
  const params=await searchParams,revision=Number(params.revision);
  if(params.case!=='case-1'||params.revision!=='6'||revision!==6)return <main><h1>Saved synthetic estimate QA</h1><p role="alert">The existing synthetic Case1 at saved revision6 is required.</p></main>;
  return <P5QaSavedEstimate key={revision} revision={revision}/>;
}
