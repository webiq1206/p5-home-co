import {qaDocumentProject} from './qaPaid.ts';
import {z} from 'zod';
import {documentServiceConfiguration,documentServiceHeaders,remoteDocumentId,partitionDocumentServiceUploads,sourceIdentity} from './documentServiceClient.ts';
import {fetchWithinDeadline} from './processingBudget.ts';
import {query} from './database.ts';
import {DraftError,type Draft} from './store.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {projectHash} from './projectRecord.ts';

const identity=z.object({version:z.literal('p5-page-evidence-v2'),id:z.string().min(1),project:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),name:z.string(),state:z.string(),revision:z.string().min(1),pageCount:z.number().int().positive()});
const pageStatus=z.enum(['read','partial','unreadable','pending']);
const manifestSchema=identity.extend({complete:z.boolean(),pages:z.array(z.object({page:z.number().int().positive(),status:pageStatus,notes:z.array(z.string())}))});
const pageSchema=identity.extend({page:z.object({number:z.number().int().positive(),native:z.object({text:z.string(),textQuality:z.unknown(),kind:z.string(),width:z.number().nullable(),height:z.number().nullable(),spanCoordinates:z.unknown(),spans:z.array(z.unknown())}),readerObservation:z.unknown()})});
export type ProjectPage=z.infer<typeof pageSchema>['page']&{status:z.infer<typeof pageStatus>;notes:string[]};
export interface ProjectDocumentEvidence {fileId:string;name:string;sha256:string;revision:string;pageCount:number;pages:ProjectPage[]}
export interface ProjectPageEvidence {documents:ProjectDocumentEvidence[];issues:string[]}
export interface ProjectPageCache {read(key:string):Promise<unknown>;write(key:string,value:unknown):Promise<void>}
function pageCache(draftId:string):ProjectPageCache{return {
 async read(key){const [row]=await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draftId,key]);return row?.payload;},
 async write(key,value){await query('INSERT INTO p5_estimator_work(draft_id,work_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(draft_id,work_key) DO NOTHING',[draftId,key,JSON.stringify(value)]);},
};}

/** Read existing evidence only. No uploads, analysis jobs or provider calls.
 * Original pages are fetched in bounded batches and cached independently, so
 * an interrupted large retrieval resumes without losing completed pages. */
export async function loadProjectPageEvidence(draft:Pick<Draft,'id'|'brand'|'uploads'>,options:{request?:typeof fetch;env?:Readonly<Record<string,string|undefined>>;deadline?:number;cache?:ProjectPageCache}={}):Promise<ProjectPageEvidence>{
 if(ESTIMATOR_BRAND.domain!=='p5homeco.com'||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Page evidence is restricted to this P5 project.',403);
 const env=options.env||process.env,remote=partitionDocumentServiceUploads(draft.uploads,env).remote;
 if(!remote.length)return {documents:[],issues:[]};
 const {tenant,secret,origin,limits}=documentServiceConfiguration(env),request=options.request||fetch,deadline=options.deadline||Date.now()+60000,cache=options.cache||pageCache(draft.id);
 const project=await qaDocumentProject(draft.id);
 const documents:ProjectDocumentEvidence[]=[],issues:string[]=[];let total=0;
 const get=async(path:string)=>{
  const response=await fetchWithinDeadline(request,origin.origin+origin.pathname.replace(/\/$/,'')+path,{method:'GET',redirect:'error',headers:documentServiceHeaders('GET',path,tenant,secret,Buffer.alloc(0))},Math.min(deadline,Date.now()+20000));
  if(!response.ok)throw new DraftError(`Original page evidence is unavailable (HTTP ${response.status}). Saved files and completed reads are preserved.`,503);
  try{return await response.json();}catch{throw new DraftError('The original page response could not be verified. Saved files are preserved.',503);}
 };
 for(const upload of remote){
  const id=remoteDocumentId(tenant,project,upload.sha256),path=`/v1/projects/${encodeURIComponent(project)}/documents/${id}/evidence`;
  const parsed=manifestSchema.safeParse(await get(path));
  if(!parsed.success)throw new DraftError('The document reader must provide a valid original-page manifest before qualification.',503);
  const manifest=parsed.data;
  if(manifest.id!==id||manifest.project!==project||manifest.sha256!==upload.sha256)throw new DraftError('The page manifest does not belong to this uploaded file.',503);
  total+=manifest.pageCount;
  if(total>limits.maxPages)throw new DraftError('The combined original-page inventory exceeds the configured project limit.',422);
  if(manifest.pages.length!==manifest.pageCount||manifest.pages.some((p,i)=>p.page!==i+1))throw new DraftError('The original-page inventory is missing, repeated or out of order. Saved reads are preserved.',503);
  const name=sourceIdentity(upload,draft.uploads),document:ProjectDocumentEvidence={fileId:upload.id,name,sha256:upload.sha256,revision:manifest.revision,pageCount:manifest.pageCount,pages:[]};
  if(manifest.state!=='complete'||manifest.pages.some(p=>p.status==='pending'))issues.push(`${name}: original page reading has not finished.`);
  for(let start=0;start<manifest.pageCount;start+=4){
   const results=await Promise.allSettled(manifest.pages.slice(start,start+4).map(async entry=>{
    const key='project-page:'+projectHash({tenant,project,id,revision:manifest.revision,page:entry.page});
    const saved=await cache.read(key),raw=saved??await get(path+'?page='+entry.page),page=pageSchema.safeParse(raw);
    if(!page.success||page.data.id!==id||page.data.project!==project||page.data.sha256!==upload.sha256||page.data.revision!==manifest.revision||page.data.pageCount!==manifest.pageCount||page.data.page.number!==entry.page)throw new DraftError('The original page changed during retrieval or failed identity checks. Resume with its current manifest.',503);
    if(saved===undefined||saved===null)await cache.write(key,page.data);
    return {...page.data.page,status:entry.status,notes:entry.notes};
   }));
   for(const result of results)if(result.status==='fulfilled')document.pages.push(result.value);
   const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }
  documents.push(document);
 }
 return {documents,issues};
}
