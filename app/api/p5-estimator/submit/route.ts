import {after} from "next/server";
import {postSubmission} from "@/lib/p5/submitEndpoint";
export async function POST(request:Request){return postSubmission(request,task=>after(task));}
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
