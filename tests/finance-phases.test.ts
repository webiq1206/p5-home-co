import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PHASES,
  findPhase,
  phasesFor,
  phasesInFamily,
  separatesDesignFromBuild,
} from "../app/lib/finance/phases.ts";

test("phase codes are unique and sort into build order as strings", () => {
  // Zero padding is why 03-09 sorts before 03-10. Without it the taxonomy reads
  // out of sequence in every report that sorts by code, which is all of them.
  const codes = PHASES.map((p) => p.code);
  assert.equal(new Set(codes).size, codes.length, "duplicate phase code");

  const build = phasesInFamily("build").map((p) => p.code);
  assert.deepEqual(build, [...build].sort(), "build phases must sort into build order");
});

test("design is a family of its own, because design-build depends on it", () => {
  // Collapsing Plan and Design into "preconstruction" would make the
  // design-fee credit impossible to compute.
  assert.ok(phasesInFamily("design").length > 0);
  assert.ok(separatesDesignFromBuild("new_build"));
  assert.ok(separatesDesignFromBuild("remodel"));
  assert.ok(separatesDesignFromBuild("adu"));
});

test("handyman and cabinet jobs do not carry a design phase", () => {
  assert.equal(separatesDesignFromBuild("handyman"), false);
  assert.equal(separatesDesignFromBuild("cabinet"), false);
});

test("each project kind gets a menu that fits the work", () => {
  const names = (kind: Parameters<typeof phasesFor>[0]) =>
    phasesFor(kind).map((p) => p.name);

  // A remodel happens inside somebody's home; a new build does not.
  assert.ok(names("remodel").includes("Temporary Protection and Containment"));
  assert.ok(!names("new_build").includes("Temporary Protection and Containment"));

  // Nothing to demolish on a bare lot.
  assert.ok(!names("new_build").includes("Demolition"));
  assert.ok(names("remodel").includes("Demolition"));

  // Excavation is a new build and ADU concern.
  assert.ok(names("new_build").includes("Excavation and Foundation"));
  assert.ok(!names("remodel").includes("Excavation and Foundation"));

  // A handyman job is not framing a house or landscaping it.
  assert.ok(!names("handyman").includes("Framing"));
  assert.ok(!names("handyman").includes("Exterior and Landscape"));
  assert.ok(names("handyman").includes("Plumbing"));
});

test("a standalone cabinet job uses CAB phases and nothing else", () => {
  const cabinet = phasesFor("cabinet");
  assert.ok(cabinet.length > 0);
  for (const phase of cabinet) {
    assert.equal(phase.family, "cabinet", `${phase.code} should not apply to a standalone cabinet job`);
  }
  // And cabinets inside a construction job use the Build phase instead.
  assert.equal(findPhase("03-16")?.name, "Cabinets");
  assert.ok(!phasesFor("new_build").some((p) => p.family === "cabinet"));
});

test("every phase kind has at least one phase, so no project opens empty", () => {
  for (const kind of ["new_build", "remodel", "adu", "handyman", "cabinet"] as const) {
    assert.ok(phasesFor(kind).length > 0, kind);
  }
});

test("the four gaps raised on the original list are covered", () => {
  const all = PHASES.map((p) => p.name).join(" | ");
  assert.match(all, /Exterior and Landscape/);
  assert.match(all, /Fixtures and Appliances/);
  assert.match(all, /Temporary Protection/);
  assert.match(all, /Excavation and Foundation/);
  // Permits live with the drawings they follow, which is Design.
  assert.match(findPhase("02")?.note ?? "", /[Pp]ermit/);
});

test("an unknown code returns null rather than guessing", () => {
  assert.equal(findPhase("03-99"), null);
  assert.equal(findPhase(""), null);
});
