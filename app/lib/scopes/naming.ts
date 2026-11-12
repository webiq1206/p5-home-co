/**
 * One consistent name for every project. Pure, shared by server and browser.
 *
 * Owner rule: client last name, then the street number and street name (no
 * city, state or ZIP), then the type of project. For example:
 *   "Brost - 2283 N Coopers Hawk Ave - Remodel"
 * The name is always derived from those three facts and is never typed by
 * hand, so two people can never name the same job two different ways.
 */

export const SERVICE_LABELS: Record<string, string> = {
  kitchen: "Kitchen remodel",
  bathroom: "Bathroom remodel",
  remodel: "Remodel",
  "whole-home": "Whole-home remodel",
  addition: "Addition",
  adu: "ADU",
  "new-construction": "New construction",
  handyman: "Handyman",
  re10: "RE-10 repairs",
  "cabinet-product": "Cabinets, product only",
  "cabinet-install": "Cabinets, installed",
};

export function serviceLabel(service: string | null | undefined): string {
  return SERVICE_LABELS[service ?? ""] ?? "Project";
}

/** Street number and street name only: everything before the first comma. */
export function streetLine(address: string | null | undefined): string {
  return (address ?? "").split(",")[0].replace(/\s+/g, " ").trim();
}

export function projectTitle(p: { lastName?: string | null; address?: string | null; service?: string | null }): string {
  const last = (p.lastName ?? "").replace(/\s+/g, " ").trim();
  return [last, streetLine(p.address), serviceLabel(p.service)].filter(Boolean).join(" - ");
}
