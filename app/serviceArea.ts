/** Towns P5 publishes as its service area, in Google Business Profile order.
 * Ada County and Canyon County sit beside this list in schema and on the page.
 * Middleton and Garden City stay as existing pages where a brand site has them;
 * they are not part of this list. */

export const citiesServed = [
  "Boise",
  "Meridian",
  "Nampa",
  "Eagle",
  "Kuna",
  "Caldwell",
  "Star",
] as const;

/** "Boise, Meridian, Nampa, Eagle, Kuna, Caldwell and Star" */
export function cityList(cities: readonly string[] = citiesServed): string {
  if (cities.length < 2) return cities.join("");
  return `${cities.slice(0, -1).join(", ")} and ${cities[cities.length - 1]}`;
}
