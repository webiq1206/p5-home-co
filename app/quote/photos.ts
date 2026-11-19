/**
 * The photographs on a quote page, chosen so that no picture appears twice.
 *
 * A quote page shows its own hero, a row of four rooms, a band between
 * sections and one picture beside the questions. The row, the band and the
 * side picture used to be fixed, so the hero's picture came round again (the
 * great room three times on the addition page). Each slot now has a second
 * photograph of the same subject, taken when the first is already on the page.
 */
import {
  BACKYARD_ADU,
  DRIVE_DINING_ROOM,
  DRIVE_KITCHEN,
  DRIVE_PRIMARY_BATH,
  FEATURED_BOISE_ADU,
  FEATURED_BOISE_BATHROOM,
  FEATURED_BOISE_EXTERIOR,
  FEATURED_BOISE_GREAT_ROOM,
  FEATURED_BOISE_KITCHEN,
  FRAMING_FOOTHILLS,
  REMODEL_KITCHEN_LIVING,
  TREASURE_VALLEY_FOOTHILLS,
  type ServedImage,
} from "../imageVariants.ts";

/** Kitchen, living space, bath, ADU: the order the row's heading names them in. */
const ROW_SLOTS: readonly (readonly ServedImage[])[] = [
  [FEATURED_BOISE_KITCHEN, DRIVE_KITCHEN],
  [FEATURED_BOISE_GREAT_ROOM, DRIVE_DINING_ROOM],
  [FEATURED_BOISE_BATHROOM, DRIVE_PRIMARY_BATH],
  [FEATURED_BOISE_ADU, BACKYARD_ADU],
];

const BAND: readonly ServedImage[] = [FEATURED_BOISE_EXTERIOR, FRAMING_FOOTHILLS, TREASURE_VALLEY_FOOTHILLS];
const BESIDE_QUESTIONS: readonly ServedImage[] = [REMODEL_KITCHEN_LIVING, DRIVE_DINING_ROOM, DRIVE_KITCHEN, FEATURED_BOISE_GREAT_ROOM];

export type QuotePhotos = {
  readonly row: readonly ServedImage[];
  readonly band: ServedImage;
  readonly besideQuestions: ServedImage;
};

export function quotePhotos(heroSrc: string): QuotePhotos {
  const used = new Set<string>([heroSrc]);
  const take = (choices: readonly ServedImage[]): ServedImage => {
    const pick = choices.find((image) => !used.has(image.src)) ?? choices[0];
    used.add(pick.src);
    return pick;
  };
  const row = ROW_SLOTS.map(take);
  const band = take(BAND);
  const besideQuestions = take(BESIDE_QUESTIONS);
  return { row, band, besideQuestions };
}
