/** Towns P5 publishes as its service area (owner, 20 November 2026: the eight
 * cities on the Google Business Profile, Middleton included, plus Garden City,
 * which the owner added the same day). Ada County and Canyon County sit beside
 * this list in schema and on the page. */

export const citiesServed = [
  "Boise",
  "Meridian",
  "Eagle",
  "Garden City",
  "Nampa",
  "Kuna",
  "Star",
  "Middleton",
  "Caldwell",
] as const;

/** "Boise, Meridian, Eagle, Garden City, Nampa, Kuna, Star, Middleton and Caldwell" */
export function cityList(cities: readonly string[] = citiesServed): string {
  if (cities.length < 2) return cities.join("");
  return `${cities.slice(0, -1).join(", ")} and ${cities[cities.length - 1]}`;
}
