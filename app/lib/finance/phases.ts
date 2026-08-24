/**
 * The P5 phase taxonomy (S225).
 *
 * Until now this lived only in a Knowledge Center article, which meant the
 * canonical list of phases was prose. Prose drifts: a phase gets used on a job
 * that is not in the article, or an article entry is never used, and nothing
 * notices either way. It is a registry now, and the article renders from it.
 *
 * THE SHAPE, AND WHY IT IS NOT A FLAT LIST
 *
 * Three families, not one sequence:
 *
 *   01 Plan    - working out what the job is
 *   02 Design  - drawing it and getting it approved
 *   03 Build   - building it, in trade order
 *
 * The temptation is to flatten Build's sequence into a single 01-22 list, which
 * reads better. It cannot be done, because P5 sells design-build: the design
 * fee is billed separately, credited against the build, and has its own margin.
 * Collapsing Plan and Design into "preconstruction" makes that credit
 * impossible to compute and hides whether design made money on its own.
 *
 * So the Build sequence is numbered 03-01 upward and reads in build order,
 * while Plan and Design stay separate families above it.
 *
 * CAB-* is for standalone Boise Cabinet Co jobs only. Cabinets inside a
 * construction project use 03-16 and stay with that project's brand.
 */

export type PhaseFamily = "plan" | "design" | "build" | "cabinet";

/** What P5 is selling. Decides which phases a project's taxonomy starts with. */
export type ProjectKind = "new_build" | "remodel" | "adu" | "handyman" | "cabinet";

export type Phase = {
  /** Sorts correctly as a string, which is why Build codes are zero padded. */
  code: string;
  family: PhaseFamily;
  name: string;
  /** The project kinds that normally use this phase. */
  appliesTo: ProjectKind[];
  /** Only where the phase is easy to misuse. */
  note?: string;
};

const CONSTRUCTION: ProjectKind[] = ["new_build", "remodel", "adu"];
const ALL_BUILD: ProjectKind[] = ["new_build", "remodel", "adu", "handyman"];

export const PHASES: Phase[] = [
  {
    code: "01",
    family: "plan",
    name: "Plan",
    appliesTo: CONSTRUCTION,
    note: "Inspections, hazardous material testing, as-builts, schematic work. Billed and measured separately from design so design-build can credit one against the other.",
  },
  {
    code: "02",
    family: "design",
    name: "Design",
    appliesTo: CONSTRUCTION,
    note: "Architecture, engineering, MEP design, permits and plan approvals. Permit fees belong here rather than in General Requirements, because they follow the drawings.",
  },

  // -- Build, in the order the work actually happens ------------------------
  { code: "03-01", family: "build", name: "General Requirements", appliesTo: ALL_BUILD, note: "Supervision, temporary services, dumpsters, portable toilets, general conditions." },
  {
    code: "03-02",
    family: "build",
    name: "Temporary Protection and Containment",
    appliesTo: ["remodel"],
    note: "Dust walls, floor protection, negative air. A remodel happens inside somebody's home; a new build does not, which is why this phase is remodel only.",
  },
  { code: "03-03", family: "build", name: "Demolition", appliesTo: ["remodel", "adu"] },
  { code: "03-04", family: "build", name: "Site Work", appliesTo: CONSTRUCTION },
  {
    code: "03-05",
    family: "build",
    name: "Excavation and Foundation",
    appliesTo: ["new_build", "adu"],
    note: "Split from Concrete because on a new build these are different trades, different risk, and often different months.",
  },
  { code: "03-06", family: "build", name: "Concrete and Flatwork", appliesTo: CONSTRUCTION },
  { code: "03-07", family: "build", name: "Framing", appliesTo: CONSTRUCTION },
  { code: "03-08", family: "build", name: "Roofing", appliesTo: CONSTRUCTION },
  { code: "03-09", family: "build", name: "Windows and Doors", appliesTo: CONSTRUCTION },
  { code: "03-10", family: "build", name: "Plumbing", appliesTo: ALL_BUILD },
  { code: "03-11", family: "build", name: "HVAC", appliesTo: ALL_BUILD },
  { code: "03-12", family: "build", name: "Electrical", appliesTo: ALL_BUILD },
  { code: "03-13", family: "build", name: "Insulation", appliesTo: CONSTRUCTION },
  { code: "03-14", family: "build", name: "Drywall", appliesTo: ALL_BUILD },
  { code: "03-15", family: "build", name: "Flooring", appliesTo: ALL_BUILD },
  {
    code: "03-16",
    family: "build",
    name: "Cabinets",
    appliesTo: CONSTRUCTION,
    note: "Cabinets INSIDE a construction project. A standalone cabinet job sold as Boise Cabinet Co uses the CAB-* phases instead.",
  },
  { code: "03-17", family: "build", name: "Countertops", appliesTo: CONSTRUCTION },
  { code: "03-18", family: "build", name: "Tile", appliesTo: ALL_BUILD },
  { code: "03-19", family: "build", name: "Painting", appliesTo: ALL_BUILD },
  { code: "03-20", family: "build", name: "Finish Carpentry", appliesTo: ALL_BUILD },
  { code: "03-21", family: "build", name: "Fixtures and Appliances", appliesTo: ALL_BUILD },
  { code: "03-22", family: "build", name: "Exterior and Landscape", appliesTo: CONSTRUCTION },
  { code: "03-23", family: "build", name: "Final and Punch", appliesTo: ALL_BUILD },
  { code: "03-24", family: "build", name: "Closeout", appliesTo: ALL_BUILD, note: "Warranties, manuals, final waivers, as-builts handed over." },

  // -- Standalone cabinet jobs ---------------------------------------------
  { code: "CAB-01", family: "cabinet", name: "Design and Measure", appliesTo: ["cabinet"] },
  { code: "CAB-02", family: "cabinet", name: "Cabinet Product", appliesTo: ["cabinet"] },
  { code: "CAB-03", family: "cabinet", name: "Freight and Delivery", appliesTo: ["cabinet"] },
  { code: "CAB-04", family: "cabinet", name: "Installation", appliesTo: ["cabinet"] },
  { code: "CAB-05", family: "cabinet", name: "Countertops", appliesTo: ["cabinet"] },
  { code: "CAB-06", family: "cabinet", name: "Field Modifications", appliesTo: ["cabinet"] },
];

/**
 * The phases a project of this kind starts with.
 *
 * A starting menu, not a cage: a job can add a phase it needs. The point is
 * that a remodel does not open with an Excavation phase it will never use, and
 * a new build is not offered dust containment.
 */
export function phasesFor(kind: ProjectKind): Phase[] {
  return PHASES.filter((p) => p.appliesTo.includes(kind));
}

export function phasesInFamily(family: PhaseFamily): Phase[] {
  return PHASES.filter((p) => p.family === family);
}

export function findPhase(code: string): Phase | null {
  return PHASES.find((p) => p.code === code) ?? null;
}

/**
 * Whether a project kind bills design separately from build.
 *
 * The reason the families exist. Design-build credits the design fee against
 * the build, and that arithmetic needs design costs to sit somewhere of their
 * own.
 */
export function separatesDesignFromBuild(kind: ProjectKind): boolean {
  return phasesFor(kind).some((p) => p.family === "design");
}
