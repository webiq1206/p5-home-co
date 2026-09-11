import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { ESTIMATOR_BUCKETS, uploadObjectKey, storeObject, readStoredBytes } from "../lib/p5/objectStorage.ts";

test("each brand and draft has a separate storage namespace", () => {
  assert.equal(new Set(Object.values(ESTIMATOR_BUCKETS)).size, 5);
  const id="12345678-1234-4234-8234-123456789abc", digest="a".repeat(64);
  const keys=Object.keys(ESTIMATOR_BUCKETS).map(domain=>uploadObjectKey(domain,id,digest));
  assert.equal(new Set(keys).size,5);
  assert.throws(()=>uploadObjectKey("unknown.example",id,digest));
  assert.throws(()=>uploadObjectKey("p5homeco.com","../another",digest));
});
test("legacy database uploads remain readable", async()=>{
  const data=Buffer.from("existing project scope");
  assert.deepEqual(await readStoredBytes({data_base64:data.toString("base64")}),data);
});
test("storage receipts, failures and downloaded byte integrity", async(t)=>{
  const previous=process.env.P5_OBJECT_STORAGE_ENABLED;
  process.env.P5_OBJECT_STORAGE_ENABLED="true";
  t.after(()=>{if(previous===undefined)delete process.env.P5_OBJECT_STORAGE_ENABLED;else process.env.P5_OBJECT_STORAGE_ENABLED=previous;});
  const data=Buffer.from("new scope"),digest=createHash("sha256").update(data).digest("hex");
  const upload=t.mock.method(Client.prototype,"uploadFromBytes",async()=>({ok:true,value:null}));
  t.mock.method(Client.prototype,"downloadAsBytes",async()=>({ok:true,value:[data]}));
  const location=await storeObject("p5homeco.com","12345678-1234-4234-8234-123456789abc",data);
  assert.equal(upload.mock.calls.length,1);
  assert.ok(location);
  const row={data_base64:"",storage_bucket:location.bucketId,storage_key:location.objectKey,sha256:digest,size_bytes:data.length};
  assert.deepEqual(await readStoredBytes(row),data);
  await assert.rejects(readStoredBytes({...row,sha256:"b".repeat(64)}),/verification failed/);
  upload.mock.mockImplementation(async()=>({ok:false as const,error:{message:"denied"}}));
  await assert.rejects(storeObject("p5homeco.com","12345678-1234-4234-8234-123456789abc",data),/could not be saved/);
});
