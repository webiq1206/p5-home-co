import {postOpen} from "@/lib/p5/driveEndpoint";
export async function POST(request:Request){return postOpen(request);}
export const runtime="nodejs";
export const dynamic="force-dynamic";
