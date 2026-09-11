/** Materialize multipart bytes before sending; no device-backed File handles remain. */
export async function encodeProjectUpload(form: FormData) {
  const boundary = `p5-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const quote = (value: string) => value.replace(/[\r\n]/g, "_").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  for (const [name, value] of form.entries()) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"`;
    if (typeof value === "string") {
      chunks.push(encoder.encode(`${header}\r\n\r\n${value}\r\n`));
    } else {
      const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.type) ? value.type : "application/octet-stream";
      chunks.push(encoder.encode(`${header}; filename="${quote(value.name)}"\r\nContent-Type: ${mime}\r\n\r\n`));
      chunks.push(new Uint8Array(await value.arrayBuffer()));
      chunks.push(encoder.encode("\r\n"));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return {body, contentType: `multipart/form-data; boundary=${boundary}`};
}
