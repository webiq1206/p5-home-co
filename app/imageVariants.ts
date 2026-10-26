/** Served WebP masters. Each entry is one file, with that width in srcset. */

export type ServedImage = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly srcSet: string;
  readonly sizes: string;
};

export const FRAMING_FOOTHILLS = {
  src: "/images/framing-foothills.webp",
  width: 1536,
  height: 1024,
  alt: "New home framing with roof trusses and a lumber stack near the foothills",
  srcSet: "/images/framing-foothills.webp 1536w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const BASEBOARD_TRIM_FIT = {
  src: "/images/baseboard-trim-fit.webp",
  width: 1448,
  height: 1086,
  alt: "New white baseboard with a loose piece, a hammer, a nail set and a coping saw on an oak floor",
  srcSet: "/images/baseboard-trim-fit.webp 1448w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

/** One cohesive Boise foothills custom home across exterior and rooms. */
export const FEATURED_BOISE_EXTERIOR = {
  src: "/images/featured-boise-exterior.webp",
  width: 1280,
  height: 720,
  alt: "Modern two-story custom home with charcoal vertical siding and warm window light in the Boise foothills",
  srcSet: "/images/featured-boise-exterior.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_GREAT_ROOM = {
  src: "/images/featured-boise-great-room.webp",
  width: 1280,
  height: 720,
  alt: "Great room with oak floors, a stone fireplace, and floor-to-ceiling windows overlooking the Idaho foothills",
  srcSet: "/images/featured-boise-great-room.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_KITCHEN = {
  src: "/images/featured-boise-kitchen.webp",
  width: 1280,
  height: 720,
  alt: "Open kitchen with light oak cabinets, a dark island, and sliding doors looking to the Boise foothills",
  srcSet: "/images/featured-boise-kitchen.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_BATHROOM = {
  src: "/images/featured-boise-bathroom.webp",
  width: 1280,
  height: 720,
  alt: "Primary bathroom with a freestanding tub, glass shower, and light oak vanity beside a foothills window",
  srcSet: "/images/featured-boise-bathroom.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_ADU = {
  src: "/images/featured-boise-adu.webp",
  width: 1280,
  height: 720,
  alt: "Matching charcoal board-and-batten ADU with a dark metal roof and covered entry in a Boise backyard",
  srcSet: "/images/featured-boise-adu.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const TREASURE_VALLEY_FOOTHILLS = {
  src: "/images/treasure-valley-foothills.webp",
  width: 1280,
  height: 720,
  alt: "Dry Boise foothills with sagebrush and golden grass above the Treasure Valley",
  srcSet: "/images/treasure-valley-foothills.webp 1280w",
  sizes: "100vw",
} as const satisfies ServedImage;

export const CRAFT_TRIM_DETAIL = {
  src: "/images/craft-trim-detail.webp",
  width: 1152,
  height: 864,
  alt: "White baseboard and door casing fitted along oak flooring with finish carpentry tools nearby",
  srcSet: "/images/craft-trim-detail.webp 1152w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const imageVariants = {
  framingFoothills: FRAMING_FOOTHILLS,
  baseboardTrimFit: BASEBOARD_TRIM_FIT,
  featuredBoiseExterior: FEATURED_BOISE_EXTERIOR,
  featuredBoiseGreatRoom: FEATURED_BOISE_GREAT_ROOM,
  featuredBoiseKitchen: FEATURED_BOISE_KITCHEN,
  featuredBoiseBathroom: FEATURED_BOISE_BATHROOM,
  featuredBoiseAdu: FEATURED_BOISE_ADU,
  treasureValleyFoothills: TREASURE_VALLEY_FOOTHILLS,
  craftTrimDetail: CRAFT_TRIM_DETAIL,
} as const;

const bySrc = new Map<string, ServedImage>(Object.values(imageVariants).map((variant) => [variant.src, variant]));

export function imageVariantFor(src: string): ServedImage | undefined {
  return bySrc.get(src);
}
