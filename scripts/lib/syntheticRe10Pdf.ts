/**
 * A one-page PDF, built by hand.
 *
 * No dependency for a test fixture, and a real PDF rather than an image means
 * the extraction check exercises the same document block a genuine RE-10
 * arrives in. Its own module so the fixture can be validated without running
 * the check that costs an API call.
 */
export function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let content = "BT\n/F1 10 Tf\n1 0 0 1 56 740 Tm\n14 TL\n";
  for (const line of lines) content += `(${esc(line)}) Tj\nT*\n`;
  content += "ET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Deliberately shaped like the awkward parts of a real RE-10: a quantity stated
 * in the text, a quantity NOT stated, a repair that is a repair rather than a
 * replacement, an item that must go for an onsite look however tempting it is
 * to price, and a line that is not a repair request at all.
 */
export const SYNTHETIC_RE10 = [
  "RE-10 INSPECTION RESPONSE AND RESOLUTION",
  "Property: 4127 W Sunridge Ave, Boise, ID 83703",
  "Buyer: R. Alvarez        Seller: T. Whitfield",
  "Response deadline: fourteen (14) days from acceptance",
  "",
  "Seller agrees to complete the following at Seller's expense,",
  "by a licensed contractor, prior to final walkthrough:",
  "",
  "1. Install GFCI protection at the two kitchen counter",
  "   receptacles noted on page 14 of the inspection report.",
  "",
  "2. Repair drywall damage in the garage, approximately 40",
  "   square feet, and repaint the affected wall to match.",
  "",
  "3. Repair the running toilet in the guest bathroom.",
  "",
  "4. Re-caulk and seal the exterior windows on the south",
  "   elevation where separation was noted.",
  "",
  "5. Secure the loose stair handrail at the basement stairs.",
  "   Handrail is otherwise sound; replacement not required.",
  "",
  "6. Evaluate and repair the foundation crack observed in the",
  "   crawlspace on the north wall, per inspector comment 7.3.",
  "",
  "7. Seller to provide all appliance manuals and warranty",
  "   documentation at closing.",
];
