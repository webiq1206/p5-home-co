/**
 * A reader for dBASE (.dbf) tables, the format county GIS offices publish.
 * Reads straight from the file's bytes, one record at a time, so a large table
 * is never held as objects all at once.
 */

export type DbfField = { name: string; offset: number; length: number };

export function dbfHeader(data: Buffer): { records: number; headerLength: number; recordLength: number; fields: DbfField[] } {
  if (data.length < 33) throw new Error("This is not a readable .dbf table.");
  const records = data.readUInt32LE(4);
  const headerLength = data.readUInt16LE(8);
  const recordLength = data.readUInt16LE(10);
  const fields: DbfField[] = [];
  let offset = 1; // each record starts with a one-byte deleted flag
  for (let at = 32; at + 32 <= headerLength && data[at] !== 0x0d; at += 32) {
    const end = data.indexOf(0, at);
    const name = data.toString("latin1", at, Math.min(end === -1 ? at + 11 : end, at + 11)).trim();
    const length = data[at + 16];
    fields.push({ name, offset, length });
    offset += length;
  }
  return { records, headerLength, recordLength, fields };
}

/** Visit every live record. `get(name)` returns a field's trimmed text, or "" when the table has no such field. */
export function eachDbfRecord(data: Buffer, visit: (get: (name: string) => string) => void): number {
  const { records, headerLength, recordLength, fields } = dbfHeader(data);
  const byName = new Map(fields.map((f) => [f.name.toUpperCase(), f]));
  let seen = 0;
  for (let i = 0; i < records; i++) {
    const start = headerLength + i * recordLength;
    if (start + recordLength > data.length) break;
    if (data[start] === 0x2a) continue; // deleted
    seen++;
    visit((name) => {
      const f = byName.get(name.toUpperCase());
      return f ? data.toString("latin1", start + f.offset, start + f.offset + f.length).trim() : "";
    });
  }
  return seen;
}
