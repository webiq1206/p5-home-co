/** Sam r1 replacements. Each master is one WebP, served with that width in srcset. */

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

export const imageVariants = {
  framingFoothills: FRAMING_FOOTHILLS,
  baseboardTrimFit: BASEBOARD_TRIM_FIT,
} as const;

const bySrc = new Map<string, ServedImage>(Object.values(imageVariants).map((variant) => [variant.src, variant]));

export function imageVariantFor(src: string): ServedImage | undefined {
  return bySrc.get(src);
}
