import type {AnalysisFile} from './extraction.ts';
/**
 * Which OpenAI model reads which kind of page (owner request 2026-09-21: speed with the best accuracy).
 *
 * Measured live on the owner's documents (scripts/p5-read-benchmark.mjs, 2026-09-21):
 * - RE-10 notice (form text): gpt-4.1 read each page in 6 to 10 s and captured all 20 repair items in
 *   the notice's wording; gpt-5.6-sol took 30 to 35 s and, from the page image, folded 12 items into one line.
 * - Permit plan sheets (drawing detail tiles): gpt-5.6-sol read 162 quantities where gpt-4.1 read 15 to 30,
 *   at 38 s against 10 s per tile. Drawings stay on the stronger model; tiles are read in parallel.
 *
 * So text and form pages (and typed scopes) go to P5_READ_FAST_MODEL (default gpt-4.1) and drawing tiles to
 * P5_READ_DRAWING_MODEL (default: the configured P5_SCOPE_OPENAI_MODEL). P5_READ_FAST_MODEL=off keeps
 * every read on the configured model.
 */
export const isDrawingUnit=(files:readonly AnalysisFile[])=>files.some(f=>Boolean(f.detailViews)||/detail regions|detail views|supplied whole/i.test(f.name));
export function openAiReadModel(configured:string,files:readonly AnalysisFile[]):string{
  if(isDrawingUnit(files))return (process.env.P5_READ_DRAWING_MODEL||configured).trim();
  const fast=(process.env.P5_READ_FAST_MODEL||'gpt-4.1').trim();
  return fast.toLowerCase()==='off'?configured:fast;
}
/** Rate-limit replies (429) from the managed OpenAI connection arrive in bursts; wait briefly and resend. */
export const RATE_LIMIT_RETRIES=Number(process.env.P5_READ_429_RETRIES||3);
export const rateLimitWaitMs=(attempt:number,retryAfterHeader:string|null)=>{
  const header=retryAfterHeader&&/^\d+(\.\d+)?$/.test(retryAfterHeader)?Number(retryAfterHeader)*1000:0;
  return Math.min(8000,Math.max(header,1500*2**attempt))+Math.floor(Math.random()*500);
};

/** Typed scope uses the fast OpenAI reader first. Explicit host selection and
 * document routing stay authoritative; unavailable providers still fall back. */
export function preferredReadProvider(files:readonly AnalysisFile[],configured=process.env.P5_SCOPE_PROVIDER):'OpenAI'|'Anthropic'{
  if(configured?.trim())return configured.trim().toLowerCase()==='openai'?'OpenAI':'Anthropic';
  return files.length?'Anthropic':'OpenAI';
}
