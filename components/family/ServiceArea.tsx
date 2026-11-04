import type { ReactNode } from 'react';

/** A quiet architectural image gives service geography its own editorial beat. */
export function ServiceArea({ image, children }: {
  image: { src: string; alt: string; width: number; height: number };
  children: ReactNode;
}) {
  return (
    <section className="fam-service-area" data-family-service-area="">
      <div className="fam-container fam-service-area-grid">
        <figure className="fam-service-area-image">
          {/* eslint-disable-next-line @next/next/no-img-element -- approved, already-sized WebP */}
          <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" />
        </figure>
        <div className="fam-service-area-copy">{children}</div>
      </div>
    </section>
  );
}
