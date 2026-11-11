/**
 * Supporting work that walkthroughs routinely leave out: protection,
 * disposal, supervision across trades, permits and cleanup.
 *
 * The extraction model is asked for these too; this deterministic pass is
 * the backstop so an omission does not depend on the model remembering.
 * Everything added here is `suggested` and is never priced until an employee
 * confirms it. A declined suggestion is kept (dismissed) so it is not
 * proposed again.
 */

import { costBookEntry } from "./costbook.ts";
import type { ScopeDoc, ScopeTask } from "./types.ts";

const REMODEL_SERVICES = new Set(["kitchen", "bathroom", "remodel", "whole-home", "addition", "adu", "re10"]);

const TRADE_DIVISIONS = new Set(["03", "04", "05", "06", "07", "08", "09", "12", "22", "23", "26", "27"]);

function live(doc: ScopeDoc): ScopeTask[] {
  return doc.tasks.filter((t) => !t.dismissed && t.bucket === "approved");
}

function hasCode(tasks: ScopeTask[], prefix: string): boolean {
  return tasks.some((t) => (t.costCode ?? "").startsWith(prefix));
}

function text(t: ScopeTask): string {
  return `${t.title} ${t.description}`.toLowerCase();
}

function suggestion(
  id: string,
  title: string,
  descriptionText: string,
  code: string,
  extra: Partial<ScopeTask> = {},
): ScopeTask {
  const entry = costBookEntry(code);
  return {
    id,
    title,
    description: descriptionText,
    phase: code.startsWith("00") ? "pre-construction" : "construction",
    division: code.slice(0, 2),
    bucket: "approved",
    certainty: "suggested",
    supporting: true,
    costCode: entry ? code : null,
    performer: "subcontractor",
    evidence: [],
    origin: "checklist",
    ...extra,
  };
}

/** Suggestions for supporting tasks that are missing from the approved scope. */
export function supportingSuggestions(doc: ScopeDoc, service: string): ScopeTask[] {
  const tasks = live(doc);
  if (!tasks.length) return [];
  const known = new Set(doc.tasks.map((t) => t.id));
  const out: ScopeTask[] = [];
  const add = (t: ScopeTask) => {
    if (!known.has(t.id)) out.push(t);
  };
  const construction = tasks.filter((t) => t.phase === "construction");
  const trades = new Set(construction.map((t) => t.division).filter((d) => TRADE_DIVISIONS.has(d)));
  const remodel = REMODEL_SERVICES.has(service);

  if (remodel && construction.length && !hasCode(tasks, "01-50")) {
    add(
      suggestion(
        "chk-protection",
        "Site protection",
        "Protect floors, finishes and adjacent rooms with floor protection and dust barriers for the duration of the work.",
        "01-50-04",
        { quantity: { value: 1, unit: "EA" } },
      ),
    );
  }

  const demolition = construction.filter((t) => /\b(demo|demolish|tear[- ]?out|remove|removal|rip out)\b/.test(text(t)));
  const disposalIncluded = demolition.some((t) => (t.costCode ?? "").startsWith("02-41"));
  if (demolition.length && !hasCode(tasks, "02-41") && !hasCode(tasks, "01-74")) {
    add(
      suggestion(
        "chk-demolition",
        "Demolition and haul-off",
        "Remove existing materials where new work is installed and haul debris off site.",
        "02-41-02",
        { notes: `Covers removal for: ${demolition.map((t) => t.title).join(", ")}` },
      ),
    );
  } else if (demolition.some((t) => t.performer === "internal") && !disposalIncluded && !hasCode(tasks, "01-74-0")) {
    add(
      suggestion("chk-disposal", "Debris disposal", "Dumpster and disposal fees for demolition debris.", "01-74-02", {
        quantity: { value: 1, unit: "EA" },
      }),
    );
  }

  if (trades.size >= 2 && !hasCode(tasks, "01-31")) {
    add(
      suggestion(
        "chk-coordination",
        "Project supervision and trade coordination",
        "Schedule and coordinate the trades, inspections and deliveries, and supervise the work.",
        "01-31-02",
        { performer: "internal", laborHours: { value: null, basis: "proposed" } },
      ),
    );
  }

  const permitTrades = ["22", "23", "26"].filter((d) => trades.has(d));
  const structural = construction.some((t) => /\b(beam|bearing|structural|header|framing)\b/.test(text(t)));
  if ((permitTrades.length || structural) && !hasCode(tasks, "00-20")) {
    add(
      structural
        ? suggestion("chk-permit", "Building permit", "Obtain the building permit and schedule required inspections.", "00-20-02", {
            quantity: { value: 1, unit: "EA" },
          })
        : suggestion("chk-permit", "Trade permits", "Obtain the required trade permits and schedule inspections.", "00-20-06", {
            quantity: { value: permitTrades.length, unit: "EA" },
          }),
    );
  }

  if (construction.length && !construction.some((t) => /clean/.test(text(t))) && !hasCode(tasks, "01-74")) {
    add(
      suggestion(
        "chk-cleanup",
        "Final cleanup",
        "Clean the work areas at completion and remove remaining job materials.",
        service === "handyman" ? "01-74-10" : "01-74-04",
        service === "handyman"
          ? { performer: "internal", laborHours: { value: 1, basis: "proposed" } }
          : { quantity: { value: 1, unit: "EA" } },
      ),
    );
  }
  return out;
}
