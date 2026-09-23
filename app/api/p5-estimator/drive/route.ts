import {postDrive} from "@/lib/p5/driveEndpoint";
export async function POST(request:Request){return postDrive(request);}
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
