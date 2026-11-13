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

/** One cohesive Boise foothills home across exterior and rooms: charcoal siding, oak, black-framed windows, plain daylight. */
export const FEATURED_BOISE_EXTERIOR = {
  src: "/images/featured-boise-exterior.webp",
  width: 1280,
  height: 720,
  alt: "Two-story contemporary home with charcoal vertical siding, shed roofs and a cedar entry in the Boise foothills",
  srcSet: "/images/featured-boise-exterior.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_GREAT_ROOM = {
  src: "/images/featured-boise-great-room.webp",
  width: 1280,
  height: 720,
  alt: "Great room with oak floors, a plaster fireplace wall with an oak mantel, and tall black-framed windows to the Idaho foothills",
  srcSet: "/images/featured-boise-great-room.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_KITCHEN = {
  src: "/images/featured-boise-kitchen.webp",
  width: 1280,
  height: 720,
  alt: "Open kitchen with light oak cabinets, a charcoal island with oak stools, and sliding doors looking to the Boise foothills",
  srcSet: "/images/featured-boise-kitchen.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_BATHROOM = {
  src: "/images/featured-boise-bathroom.webp",
  width: 1280,
  height: 720,
  alt: "Primary bathroom with a freestanding tub below a foothills window, a glass shower, and a light oak vanity",
  srcSet: "/images/featured-boise-bathroom.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const FEATURED_BOISE_ADU = {
  src: "/images/featured-boise-adu.webp",
  width: 1280,
  height: 720,
  alt: "Single-story ADU with charcoal vertical siding, a dark metal roof and a cedar front door in the Boise foothills",
  srcSet: "/images/featured-boise-adu.webp 1280w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const TREASURE_VALLEY_FOOTHILLS = {
  src: "/images/treasure-valley-foothills.webp",
  width: 1280,
  height: 720,
  alt: "Dry Boise foothills with sagebrush and tan grass above the Treasure Valley",
  srcSet: "/images/treasure-valley-foothills.webp 1280w",
  sizes: "100vw",
} as const satisfies ServedImage;

export const CRAFT_TRIM_DETAIL = {
  src: "/images/handyman-maintenance-detail-1122.webp",
  width: 1122,
  height: 1402,
  alt: "A hammer, a putty knife and a caulk gun on a drop cloth beside a new white baseboard and an oak floor",
  srcSet: "/images/handyman-maintenance-detail-640.webp 640w, /images/handyman-maintenance-detail-960.webp 960w, /images/handyman-maintenance-detail-1122.webp 1122w",
  sizes: "(min-width: 1101px) 57vw, 100vw",
} as const satisfies ServedImage;

/** Homepage brand panel photographs, used so the homepage shows each image once. */
export const REMODEL_KITCHEN_LIVING = {
  src: "/images/p5-remodel.webp",
  width: 1672,
  height: 941,
  alt: "Open kitchen and living room with white shaker cabinets, an oak island with three wooden stools, and an oak floor",
  srcSet: "/images/p5-remodel.webp 1672w",
  sizes: "(min-width: 1101px) 50vw, 100vw",
} as const satisfies ServedImage;

export const BACKYARD_ADU = {
  src: "/images/p5-adu.webp",
  width: 1672,
  height: 941,
  alt: "Small single-story backyard building with white lap siding, a dark metal roof, and a cedar-lined covered entry",
  srcSet: "/images/p5-adu.webp 1672w",
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
  remodelKitchenLiving: REMODEL_KITCHEN_LIVING,
  backyardAdu: BACKYARD_ADU,
} as const;

const bySrc = new Map<string, ServedImage>(Object.values(imageVariants).map((variant) => [variant.src, variant]));

export function imageVariantFor(src: string): ServedImage | undefined {
  return bySrc.get(src);
}

/** Homepage "Ideas for your home" row. File names are kept from the earlier Drive set; the alt text describes the current photographs. */
export const DRIVE_DINING_ROOM = {
  src: "/images/drive/dining-room-with-foothill-view.webp",
  width: 1200,
  height: 1200,
  alt: "Dining room with a white oak table, a black dome pendant and floor-to-ceiling black-framed windows to the Idaho foothills",
  srcSet: "/images/drive/dining-room-with-foothill-view.webp 1200w",
  sizes: "(min-width: 1101px) 33vw, 100vw",
} as const satisfies ServedImage;

export const DRIVE_KITCHEN = {
  src: "/images/drive/white-oak-kitchen-with-rattan-pendants.webp",
  width: 1200,
  height: 628,
  alt: "White oak kitchen island under two black pendants with cream cabinets and a white tile backsplash",
  srcSet: "/images/drive/white-oak-kitchen-with-rattan-pendants.webp 1200w",
  sizes: "(min-width: 1101px) 33vw, 100vw",
} as const satisfies ServedImage;

export const DRIVE_PRIMARY_BATH = {
  src: "/images/drive/glass-walk-in-shower-and-oak-vanity.webp",
  width: 1200,
  height: 628,
  alt: "Glass walk-in shower with marble-look tile beside a floating white oak double vanity",
  srcSet: "/images/drive/glass-walk-in-shower-and-oak-vanity.webp 1200w",
  sizes: "(min-width: 1101px) 33vw, 100vw",
} as const satisfies ServedImage;
