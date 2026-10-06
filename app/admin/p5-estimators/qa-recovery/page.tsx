import {requireEstimatorAdmin} from '@/lib/p5/adminAuth';
import {DraftError} from '@/lib/p5/store';
import P5QaSavedReading from '@/components/P5QaSavedReading';

export const dynamic='force-dynamic';
export default async function QaRecoveryPage({searchParams}:{searchParams:Promise<{case?:string}>}){
  try{await requireEstimatorAdmin();}
  catch(error){if(error instanceof DraftError&&error.status===403)return <main><h1>QA saved-reading recovery</h1><p>Administrator sign-in is required.</p><a href="/admin/login">Sign in</a></main>;throw error;}
  return <P5QaSavedReading initialCase={(await searchParams).case}/>;
}
