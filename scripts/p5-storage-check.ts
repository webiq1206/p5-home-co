import {randomUUID,createHash} from "node:crypto";
import {Client} from "@replit/object-storage";
import {ESTIMATOR_BUCKETS} from "../lib/p5/objectStorage.ts";

const domain=process.argv[2];
const bucketId=ESTIMATOR_BUCKETS[domain];
if(!bucketId)throw new Error("Provide a configured estimator domain.");
const client=new Client({bucketId});
const key=`diagnostics/${domain}/${randomUUID()}.txt`;
const bytes=Buffer.from("P5 estimator storage connection test. No customer data.");
const saved=await client.uploadFromBytes(key,bytes);
if(!saved.ok)throw new Error("Bucket write check failed: "+saved.error.message);
const restored=await client.downloadAsBytes(key);
if(!restored.ok||!restored.value[0].equals(bytes))throw new Error("Bucket read-back check failed.");
console.log(JSON.stringify({domain,bucketId,write:true,read:true,sha256:createHash("sha256").update(restored.value[0]).digest("hex"),testObject:key}));
