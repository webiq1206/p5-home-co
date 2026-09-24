/**
 * A synthetic plan set, big and awkward on purpose.
 *
 * The four real sets live on the owner's machine and the analyze step needs a
 * production key, so there was no way to exercise a hundred-page read from a
 * dev box or from prebuild. This builds one deterministically, shaped like the
 * things that actually went wrong on the real corpus:
 *
 * - a cover sheet whose area tabulation is the ONLY stated total, which is the
 *   trusted-share-of-nothing trap (Gambardella summed the tabulation lines and
 *   then checked them against themselves)
 * - room tags on floor plans, the way a real drafting office prints them
 * - the same room drawn on an existing plan AND a new plan, so a naive read
 *   counts one floor twice (this priced 3,056 SF for a 1,714 SF job)
 * - a deliberate CONFLICT: one room tagged at two different areas on two sheets
 * - schedules that restate quantities already visible on the plans, which is
 *   where double counting comes from
 * - work marked "BY OTHERS" and "NIC", which must never be priced
 * - an alternate and an allowance, which must never be folded into base scope
 * - dozens of detail and structural sheets carrying nothing priceable, which
 *   is what makes a full set expensive to read and cheap to skim
 */

/** Build a multi-page PDF by hand. No dependency, and a real document. */
export function buildMultiPagePdf(pages: string[][]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const objects: string[] = [];
  // 1 = catalog, 2 = pages tree, 3 = font, then two objects per page.
  const pageObjNumbers: number[] = [];
  const contentObjects: string[] = [];

  pages.forEach((lines, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    pageObjNumbers.push(pageObj);
    /* The text origin must sit INSIDE the MediaBox. An earlier version started
       at y=750 on a 612pt-tall page, so the first eleven lines of every page
       rendered off the top and were invisible to the reader - which looked
       exactly like an extractor dropping items, and cost a debugging round. */
    let content = "BT\n/F1 9 Tf\n1 0 0 1 40 580 Tm\n12 TL\n";
    for (const line of lines) content += `(${esc(line)}) Tj\nT*\n`;
    content += "ET\n";
    contentObjects.push(content);
  });

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  pages.forEach((_, i) => {
    const contentObj = 4 + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`,
    );
    const content = contentObjects[i];
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });

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

const NEW_FIRST_FLOOR = [
  ["Grand Living Room", 538],
  ["Kitchen", 303],
  ["Dining", 214],
  ["Primary Bedroom", 286],
  ["Bath 1", 88],
  ["Guest Bath", 46],
  ["W.C. 1", 18],
  ["Mudroom", 74],
  ["Pantry", 41],
] as const;

const NEW_SECOND_FLOOR = [
  ["Bedroom 2", 168],
  ["Bedroom 3", 162],
  ["Bath 2", 71],
  ["Loft", 204],
  ["Laundry", 58],
] as const;

/**
 * The full set. Returns pages as line arrays so a test can assert on content.
 *
 * Page 4 tags the Kitchen at 303 SF; page 9 tags the SAME kitchen at 268 SF.
 * That conflict is the point: a real set carries stale sheets, and a reader
 * that silently picks one is guessing at a number nobody can check.
 */
export function buildSyntheticPlanSetPages(sheetCount = 104): string[][] {
  const pages: string[][] = [];

  pages.push([
    "SHEET G0.1 - COVER SHEET AND PROJECT INFORMATION",
    "SUNRIDGE RESIDENCE - WHOLE HOME REMODEL AND SECOND STORY ADDITION",
    "4127 W Sunridge Ave, Boise, ID 83703",
    "",
    "AREA TABULATION",
    "  MAIN LEVEL (NEW):        1,608 SF",
    "  UPPER LEVEL (NEW):         663 SF",
    "  TOTAL CONDITIONED:       2,271 SF",
    "  GARAGE (UNCONDITIONED):    441 SF",
    "",
    "SCOPE: Full interior remodel of existing main level, new second",
    "storey addition over existing footprint. Existing foundation to remain.",
  ]);

  pages.push([
    "SHEET G0.2 - GENERAL NOTES AND CODE ANALYSIS",
    "2021 IRC as amended by City of Boise.",
    "Contractor to verify all dimensions in field prior to fabrication.",
    "All work by licensed subcontractors. Permit by General Contractor.",
    "",
    "ALLOWANCE: Plumbing fixtures allowance of $14,000 carried by Owner.",
    "ALTERNATE No. 1: Screened porch at rear - PRICE SEPARATELY, NOT IN BASE BID.",
    "NOT IN CONTRACT: Landscape, irrigation, and low-voltage by others.",
  ]);

  pages.push([
    "SHEET A1.0 - EXISTING CONDITIONS - MAIN LEVEL",
    "EXISTING PLAN - FOR REFERENCE ONLY - DO NOT SCALE",
    "",
    ...NEW_FIRST_FLOOR.map(([n, a]) => `  (E) ${n}   ${a} SF`),
    "",
    "TOTAL EXISTING MAIN LEVEL: 1,608 SF",
  ]);

  pages.push([
    "SHEET A2.1 - PROPOSED FLOOR PLAN - MAIN LEVEL",
    "NEW CONSTRUCTION - SCALE 1/4in = 1ft-0in",
    "",
    ...NEW_FIRST_FLOOR.map(([n, a]) => `  ${n.toUpperCase()}   ${a} SF`),
    "",
    "Ceiling height 9'-0\" typical unless noted.",
    "Kitchen island 4'-0\" x 8'-0\". Linear drain at Bath 1 shower.",
  ]);

  pages.push([
    "SHEET A2.2 - PROPOSED FLOOR PLAN - UPPER LEVEL",
    "NEW CONSTRUCTION - SCALE 1/4in = 1ft-0in",
    "",
    ...NEW_SECOND_FLOOR.map(([n, a]) => `  ${n.toUpperCase()}   ${a} SF`),
    "",
    "Ceiling height 8'-0\" typical.",
  ]);

  pages.push([
    "SHEET AD1.1 - DEMOLITION PLAN - MAIN LEVEL",
    "DEMOLITION - EXISTING TO BE REMOVED",
    "Remove all existing interior partitions at main level, 1,608 SF.",
    "Remove existing roof structure in its entirety to accommodate addition.",
    "Remove existing kitchen casework and appliances. Salvage none.",
    "Cap and remove existing plumbing at relocated fixtures.",
    "Disposal: estimate 4 x 30 CY roll-off containers.",
  ]);

  pages.push([
    "SHEET A3.1 - EXTERIOR ELEVATIONS",
    "North, South, East and West elevations shown.",
    "Siding: fiber cement lap, 8in exposure, painted.",
    "Roofing: architectural asphalt shingle, 30 year.",
  ]);

  pages.push([
    "SHEET A4.1 - DOOR AND WINDOW SCHEDULE",
    "",
    "DOOR SCHEDULE",
    "  D01  3'-0\" x 8'-0\"  Entry, insulated FG      QTY 1",
    "  D02  2'-8\" x 8'-0\"  Interior, solid core     QTY 11",
    "  D03  6'-0\" x 8'-0\"  Sliding patio            QTY 2",
    "",
    "WINDOW SCHEDULE",
    "  W01  3'-0\" x 5'-0\"  Casement, double glazed  QTY 14",
    "  W02  6'-0\" x 5'-0\"  Fixed picture            QTY 3",
    "  W03  2'-0\" x 3'-0\"  Awning, obscure          QTY 4",
  ]);

  // The conflict sheet: a superseded plan restating the kitchen at a
  // different area. Real sets carry these; silently picking one is a guess.
  pages.push([
    "SHEET A2.1a - PROPOSED FLOOR PLAN - MAIN LEVEL (REVISION 2)",
    "SUPERSEDES A2.1 - ISSUED FOR PERMIT",
    "",
    "  KITCHEN   268 SF",
    "  GRAND LIVING ROOM   538 SF",
    "  DINING   214 SF",
    "",
    "Kitchen reduced to accommodate enlarged pantry.",
  ]);

  pages.push([
    "SHEET A5.1 - INTERIOR FINISH SCHEDULE",
    "  Flooring: engineered oak throughout main level, 1,608 SF",
    "  Tile: porcelain at Bath 1, Guest Bath, W.C. 1",
    "  Cabinetry: semi-custom, painted maple",
    "  Countertops: quartz, 62 LF total",
  ]);

  pages.push([
    "SHEET M1.1 - MECHANICAL PLAN",
    "New 3-ton heat pump with air handler in attic.",
    "Existing furnace to be removed. New ductwork throughout.",
    "Bath exhaust fans, 4 total, ducted to exterior.",
  ]);

  pages.push([
    "SHEET E1.1 - ELECTRICAL PLAN",
    "New 200A panel. Existing 100A panel to be removed.",
    "Recessed LED downlights, 38 total. Under-cabinet lighting at Kitchen.",
    "GFCI protection at all counter receptacles per code.",
  ]);

  pages.push([
    "SHEET P1.1 - PLUMBING PLAN",
    "Fixture count: 3 water closets, 3 lavatories, 2 showers, 1 tub,",
    "1 kitchen sink, 1 laundry box, 1 hose bib.",
    "Relocate main stack to accommodate new Bath 2 above.",
  ]);

  pages.push([
    "SHEET S1.1 - FOUNDATION PLAN",
    "Existing foundation to remain. New pad footings at 3 locations",
    "for addition point loads. See S2.1 for details.",
  ]);

  pages.push([
    "SHEET C1.1 - SITE PLAN",
    "Lot 14, Block 3. Setbacks verified. No grading in scope.",
    "Driveway widening BY OTHERS under separate permit.",
  ]);

  // Filler: the bulk of a real permit set is details and structural sheets
  // that carry no priceable quantity but must still be looked at.
  const fillerKinds = [
    ["S", "STRUCTURAL FRAMING DETAIL", "Typical shear wall detail. See schedule for nailing."],
    ["D", "CONSTRUCTION DETAIL", "Typical wall assembly, R-21 batt, 1/2in gypsum board."],
    ["D", "TYPICAL SECTION", "Section through exterior wall at floor line."],
    ["S", "BEAM AND HEADER SCHEDULE", "See structural notes. No quantity change."],
    ["E", "ELECTRICAL DETAIL", "Typical panel schedule and riser diagram."],
  ] as const;

  let n = 1;
  while (pages.length < sheetCount) {
    const [prefix, title, body] = fillerKinds[n % fillerKinds.length];
    pages.push([
      `SHEET ${prefix}${2 + Math.floor(n / 10)}.${(n % 10) + 1} - ${title} ${n}`,
      body,
      "This sheet carries no room areas and no schedule quantities.",
      "Reference only. Do not scale.",
    ]);
    n++;
  }

  return pages;
}

export function buildSyntheticPlanSet(sheetCount = 104): Buffer {
  return buildMultiPagePdf(buildSyntheticPlanSetPages(sheetCount));
}

/**
 * An RE-10 with a long repair list, the case a single request truncates.
 *
 * Includes the traps that matter: the same repair stated twice in different
 * words (a summary line and a detail line), a repair with a quantity and one
 * without, an item that must go to review however temptingly priceable it
 * looks, and a line that is not a repair request at all.
 */
export function buildLargeRe10Pages(itemCount = 62): string[][] {
  /**
   * Every generated item must be DISTINCT. An earlier version cycled ten
   * templates against four location numbers, which repeats exactly every
   * twenty items - so a "62 item" document held about twenty-three unique
   * requests, the extractor correctly returned twenty-two, and the check read
   * that as a truncation failure. The fixture was wrong, not the pipeline.
   * Rooms and ordinals now advance independently of the template.
   */
  const templates = [
    "Install GFCI protection at the counter receptacles in {room}.",
    "Repair drywall damage in {room}, approximately {n} square feet, and repaint.",
    "Repair the running toilet in {room}.",
    "Re-caulk and seal the exterior windows on the {room} elevation.",
    "Secure the loose stair handrail at {room}.",
    "Replace {n} missing electrical cover plates in {room}.",
    "Repair minor roof flashing at the penetration above {room}.",
    "Service the exhaust fan in {room}.",
    "Repair the sticking interior door at {room}.",
    "Replace the damaged window screen at {room}.",
  ];

  const rooms = [
    "the primary bedroom", "bedroom 2", "bedroom 3", "bedroom 4", "the hall bathroom",
    "the guest bathroom", "the primary bathroom", "the powder room", "the kitchen",
    "the pantry", "the mudroom", "the laundry room", "the upstairs landing",
    "the basement stairwell", "the garage", "the north elevation", "the south elevation",
    "the east elevation", "the west elevation", "the front porch", "the rear deck",
    "the dining room", "the living room", "the family room", "the study",
    "the utility closet", "the linen closet", "the entry hall", "the back hall",
    "the attic access", "the crawlspace hatch", "the side yard gate",
  ];

  const pages: string[][] = [];
  const header = [
    "RE-10 INSPECTION RESPONSE AND RESOLUTION - ADDENDUM",
    "Property: 4127 W Sunridge Ave, Boise, ID 83703",
    "Buyer: R. Alvarez        Seller: T. Whitfield",
    "Response deadline: fourteen (14) days from acceptance",
    "",
    "Seller agrees to complete the following at Seller's expense:",
    "",
  ];

  let item = 1;
  let page: string[] = [...header];
  /* The duplicate trap must restate an item that ACTUALLY EXISTS. An earlier
     version referred to "item 3" while item 3 was a window screen, so there
     was no partner to match and the duplicate detector was blamed for a
     fixture bug. The first generated item's text and number are captured here
     and restated verbatim at the end. */
  let firstItemText = "";
  let firstItemNumber = 0;
  while (item <= itemCount) {
    // Template and room advance on different cycles, and the room list is
    // longer than the template list, so no two generated items coincide.
    const t = templates[item % templates.length];
    const room = rooms[(item * 7) % rooms.length];
    const text = t.replace("{room}", room).replace("{n}", String(6 + (item % 37)));
    if (!firstItemText) {
      firstItemText = text;
      firstItemNumber = item;
    }
    page.push(`${item}. ${text}`);
    page.push("");
    if (page.length > 40) {
      pages.push(page);
      page = [`RE-10 ADDENDUM - CONTINUED (page ${pages.length + 1})`, ""];
    }
    item++;
  }

  // The traps, always last so their position is predictable in assertions.
  page.push(`${item++}. Evaluate and repair the foundation crack observed in the`);
  page.push("   crawlspace on the north wall, per inspector comment 7.3.");
  page.push("");
  /* The same work as item `firstItemNumber`, worded differently and referring
     back to it. Must be FLAGGED as a possible restatement, never silently
     merged (that would lose scope) and never silently priced twice. */
  page.push(`${item++}. ${firstItemText.replace(/\.$/, "")} (see item ${firstItemNumber} above).`);
  page.push("");
  page.push(`${item++}. Seller to provide appliance manuals and warranty`);
  page.push("   documentation at closing.");
  pages.push(page);

  return pages;
}

export function buildLargeRe10(itemCount = 62): Buffer {
  return buildMultiPagePdf(buildLargeRe10Pages(itemCount));
}
