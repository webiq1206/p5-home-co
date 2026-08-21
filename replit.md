# P5 Home Co

Marketing website for P5 Home Co, the operating parent company behind
Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, and Boise
Handyman Co, serving Idaho's Treasure Valley.

This is an approved, finished site. Treat the current visual design and
responsive behavior as the source of truth. See `CLAUDE.md` for the full
project instructions.

## Do not do these things

These have all happened before and each one broke the project. Please
read this section before making changes.

- **Do not convert this to Vite**, or to any other framework or bundler.
  It is Next.js and must stay Next.js. Do not add a `vite.config.*`, a
  root `index.html`, or a `src/main.tsx` entry point.
- **Do not re-apply the pnpm workspace scaffold.** This is a single
  package, not a workspace. Do not create `lib/`, `artifacts/`,
  `scripts/`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or
  `tsconfig.base.json`. Adding them breaks `npm run build`, because
  TypeScript picks up scaffold files whose dependencies are not
  installed. The marker at `.migration-backup/.scaffold-applied` records
  that the migration already ran; leave it in place.
- **Do not install with pnpm.** Use npm. `package-lock.json` pins exact
  versions and is authoritative.
- **Do not change dependency versions.** Next.js is pinned at 16.3.0.
- **Do not edit `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, or
  anything in `public/`.** The design, copy, imagery, brand logos, and
  the three-step project matcher are approved and final.
- **Do not overwrite `CLAUDE.md` or delete `README.md`.** `CLAUDE.md`
  holds the project instructions and has previously been replaced with a
  single `@AGENTS.md` pointer, destroying them.
- **Do not commit `.next/`.** It is build output and is gitignored.

## Stack

- Next.js 16.3.0, App Router, React 19.2.6, TypeScript 5.9.3
- No database, no API server, no backend. Every route is static.
- Local fonts and self-hosted imagery, no external asset dependencies.

## Run and operate

- `npm install` — install dependencies
- `npm run dev` — local development
- `npm run lint` — ESLint
- `npm run build` — production build
- `npm run start` — serve the production build

Run `npm run lint` and `npm run build` before considering any change
complete.

## Where things live

- `app/page.tsx` — the entire page structure and the project matcher
- `app/globals.css` — the complete visual system and responsive rules
- `app/layout.tsx` — metadata and the application shell
- `public/images/` — production photography
- `public/brands/` — the Boise company logos
- `public/fonts/` — local display and body fonts
- `app/site.ts` — the five companies, the cities served, and the FAQ.
  The FAQ section and the FAQPage schema both read from here, so the
  structured data cannot drift from the visible copy. Edit questions
  there, never in one place only.

## Deployment

Deployment is configured in `.replit` as an autoscale target:

- build: `npm run build`
- run: `npm run start -- -H 0.0.0.0 -p ${PORT:-3000}`

Both commands are required. An earlier config set the deployment target
without a run command, which made publishing fail with "Could not find
run command".

## Analytics

GA4 property "P5 Home Co" (550935991) in the "Websites (BRC, BCC, REC,
ASOS)" account (396104300). Measurement ID `G-K4PK6PMZP9`, set in
`app/site.ts`. The tag loads in production only, so `npm run dev` never
reports into the property.

Custom events, all fired through `app/analytics.ts`:

- `matcher_open` — the project matcher was opened
- `matcher_result` — a match was reached (params: company, project)
- `company_click` — click through to a company site (params: company, location)
- `phone_click` — a telephone link was tapped (params: company, location)

`company_click` and `phone_click` are the real conversions and are
marked as key events in GA, with no default monetary value and counted
once per event.

They were registered through Admin, Events, Create event, using the
"Create with code" mode, which declares an event by name for code that
is already firing it. That is the way to mark a key event before GA has
processed the event; the star on the Key events tab only works for
events GA has already seen, and processing takes up to 24 hours.

If you rename an event in `app/analytics.ts`, the GA declaration will no
longer match and the conversion silently stops counting. Rename in both
places.

## Gotchas

- There are five companies, and the order on the page is deliberate:
  Construction, Remodeling, ADU, Handyman, Cabinet. Do not reorder them.
- Four of the five link to their own live site:
  `https://boiseconstruction.co`, `https://boiseremodeling.co`,
  `https://boisehandyman.co`, and `https://boisecabinet.co`. Boise
  Handyman Co launched on 2026-08-20; before that it was intentionally a
  telephone link labelled "Launching soon".
- Boise ADU Co (`https://boiseadu.co`) is not built yet and the domain
  does not resolve. Its calls to action use the telephone number and it
  is labelled "Launching soon". Link it to the site only once the domain
  is live.
- The footer telephone link `(208) 477-1169` is the general P5 Home Co
  number and is not specific to Boise Handyman Co.
- All five companies use the plain **wordmark** from the brand kit, the
  horizontal lockup, not the stacked `wordmark-full`. The full lockup
  adds a tagline and "Treasure Valley - Idaho" underneath, which is
  illegible at panel size. Take these from `svg/wordmark/`, never
  `svg/wordmark-full/`. Use the `-dark` file (charcoal ink) on light
  panels and the plain file (bone ink) on dark panels.
- The wordmarks all share a 159.96 viewBox height but differ in length,
  6.16:1 for ADU up to 11.04:1 for Construction. `.brand-logo` therefore
  fixes the height and lets width follow, so the lettering is optically
  identical on every panel. Do not put them in a fixed-width box with
  object-fit, which would shrink the long ones and break the family.
- The header uses the supplied P5 horizontal lockup, not redrawn paths.
  Below 560px it swaps to the icon mark, because the lockup has a 200px
  minimum width in the brand guide. Do not rebuild either from live text.
- Favicons are the supplied set (.ico, 16, 32, apple-touch, android-chrome).
  The old placeholder favicon.svg was generic blue art and is deleted.
- Fonts are the licensed brand families, just renamed: `p5-serif.woff2`
  is Cormorant Garamond and `p5-sans.woff2` is Manrope, both variable.
  Confirmed by reading the name tables. Do not "fix" the filenames.
- Photography was reviewed against the Drive and deliberately left as is.
  The Social Assets photo sets are generic stock, which the brand guide
  rules out, and the Cabinet Pics are unstyled job-site documentation.
  Neither is marketing grade.
- `p5-adu.webp` was supplied separately and is AI generated, per the
  source filename. It shows no obvious artifacts and no people, so it
  clears the brand guide's photography bar, but it does not document a
  real completed project. The alt text describes what is in frame and
  deliberately does not claim it is a P5 build. Replace it if a real ADU
  is ever photographed.
- All five panel photographs are 1672x941 or 1536x1024 WebP, roughly
  64 to 190 KB. Match that when adding more.
