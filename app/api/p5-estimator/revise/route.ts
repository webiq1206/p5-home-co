import {postRevision} from "@/lib/p5/revisionEndpoint";
export async function POST(request:Request){return postRevision(request);}
export const runtime="nodejs";
export const dynamic="force-dynamic";
