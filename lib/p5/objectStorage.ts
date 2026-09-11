import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";

export const ESTIMATOR_BUCKETS: Record<string, string> = {
  "p5homeco.com": "replit-objstore-e9db8636-edc4-4b85-b5c7-3746dd3afbe7",
  "boiseconstruction.co": "replit-objstore-9747a152-7a58-44e0-a22e-b3ecaa1df8d5",
  "boiseremodeling.co": "replit-objstore-d1be049f-f544-4c84-a193-e3510add5735",
  "boisehandyman.co": "replit-objstore-5d123ebc-ef31-487a-8680-86cb9ef1f0d5",
  "boisecabinet.co": "replit-objstore-11dee11a-ebde-4b24-8527-428a2d058755",
};
export function uploadObjectKey(domain: string, draftId: string, digest: string) {
  if (!ESTIMATOR_BUCKETS[domain] || !/^[a-f0-9-]{36}$/i.test(draftId) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid upload storage identity.");
  return `estimates/${domain}/${draftId}/${digest}`;
}
export async function storeObject(domain: string, draftId: string, data: Buffer) {
  // Enable only after the deployed app's authenticated bucket check succeeds.
  if (process.env.P5_OBJECT_STORAGE_ENABLED !== "true") return null;
  const bucketId = ESTIMATOR_BUCKETS[domain];
  const digest = createHash("sha256").update(data).digest("hex");
  const objectKey = uploadObjectKey(domain, draftId, digest);
  const result = await new Client({ bucketId }).uploadFromBytes(objectKey, data);
  if (!result.ok) throw new Error("Your file could not be saved to storage. Please retry.");
  return { bucketId, objectKey };
}
export async function readStoredBytes(row: Record<string, unknown>) {
  if (!row.storage_key && !row.storage_bucket) {
    if (typeof row.data_base64 !== "string") throw new Error("Invalid saved file data.");
    return Buffer.from(row.data_base64, "base64");
  }
  if (typeof row.storage_key !== "string" || typeof row.storage_bucket !== "string" || !Object.values(ESTIMATOR_BUCKETS).includes(row.storage_bucket)) throw new Error("Invalid saved file location.");
  const result = await new Client({ bucketId: row.storage_bucket }).downloadAsBytes(row.storage_key);
  if (!result.ok) throw new Error("Your saved file could not be read. Please retry.");
  const data = result.value[0];
  if ((row.size_bytes !== undefined && data.length !== Number(row.size_bytes)) || (row.sha256 && createHash("sha256").update(data).digest("hex") !== row.sha256)) throw new Error("Saved file verification failed. Please retry.");
  return data;
}
