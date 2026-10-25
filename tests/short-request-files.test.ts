import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SHORT_REQUEST_FILE_BYTES,
  MAX_SHORT_REQUEST_FILES,
  MAX_SHORT_REQUEST_TOTAL_BYTES,
  readShortRequestFiles,
  sanitizeUploadName,
  ShortRequestFileError,
  sniffMime,
  type UploadLike,
} from "../app/lib/leads/shortRequestFiles.ts";

function bytes(source: string | number[]): Uint8Array {
  return typeof source === "string" ? new TextEncoder().encode(source) : Uint8Array.from(source);
}

function upload(name: string, data: Uint8Array, size = data.length): UploadLike {
  return {
    name,
    size,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
}

test("short request files accept photos and PDFs by magic bytes", () => {
  assert.equal(sniffMime(bytes([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffMime(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffMime(bytes("GIF89a")), "image/gif");
  assert.equal(sniffMime(bytes("RIFF....WEBP")), "image/webp");
  assert.equal(sniffMime(bytes("%PDF-1.7")), "application/pdf");
  const heic = new Uint8Array(16);
  heic.set(bytes("ftyp"), 4);
  heic.set(bytes("heic"), 8);
  assert.equal(sniffMime(heic), "image/heic");
  const heif = new Uint8Array(16);
  heif.set(bytes("ftyp"), 4);
  heif.set(bytes("mif1"), 8);
  assert.equal(sniffMime(heif), "image/heic");
  assert.equal(sniffMime(bytes("not a photo")), null);
});

test("short request file names drop paths and odd characters", () => {
  assert.equal(sanitizeUploadName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeUploadName("..\\\\plans\\kitchen plan.pdf"), "kitchen plan.pdf");
  assert.equal(sanitizeUploadName("....hidden"), "hidden");
  assert.equal(sanitizeUploadName(""), "upload");
});

test("short request file limits reject extras before reading them", async () => {
  assert.equal(MAX_SHORT_REQUEST_FILES, 4);
  assert.equal(MAX_SHORT_REQUEST_FILE_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_SHORT_REQUEST_TOTAL_BYTES, 20 * 1024 * 1024);

  const jpeg = bytes([0xff, 0xd8, 0xff, 0x00]);
  const tooMany = Array.from({ length: 5 }, (_, index) => upload(`photo-${index}.jpg`, jpeg));
  await assert.rejects(() => readShortRequestFiles(tooMany), (error: unknown) => {
    assert.ok(error instanceof ShortRequestFileError);
    assert.match(error.message, /4 files/);
    return true;
  });

  let read = false;
  const huge: UploadLike = {
    name: "huge.jpg",
    size: MAX_SHORT_REQUEST_FILE_BYTES + 1,
    arrayBuffer: async () => {
      read = true;
      return jpeg.buffer;
    },
  };
  await assert.rejects(() => readShortRequestFiles([huge]), /8 MB/);
  assert.equal(read, false);

  const heavy: UploadLike = { name: "a.jpg", size: 7_000_000, arrayBuffer: async () => jpeg.buffer };
  await assert.rejects(() => readShortRequestFiles([heavy, { ...heavy }, { ...heavy }]), /20 MB/);

  const stored = await readShortRequestFiles([upload("folder/plan.pdf", bytes("%PDF-1.4"))]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].mimeType, "application/pdf");
  assert.equal(stored[0].fileName, "plan.pdf");
  assert.equal(stored[0].sha256.length, 64);

  const skipped = await readShortRequestFiles([upload("empty.jpg", jpeg, 0)]);
  assert.deepEqual(skipped, []);

  await assert.rejects(() => readShortRequestFiles([upload("notes.txt", bytes("hello"))]), /JPEG, PNG/);
});
