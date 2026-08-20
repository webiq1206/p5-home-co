# P5 Home Co Next.js Website

This package contains the complete source for the approved P5 Home Co website. It includes the responsive layouts, local fonts, brand logos, production imagery, navigation, company sections, project matcher, service-area content, and all calls to action.

## Run locally

1. Install Node.js 20.9 or newer.
2. Open this folder in Claude Code or your preferred editor.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Production build

Run `npm run build`, followed by `npm run start`.

## Main files

* `app/page.tsx` contains the full page structure and project matcher.
* `app/globals.css` contains the full visual system and responsive styles.
* `app/layout.tsx` contains metadata and the application shell.
* `public/images` contains all production photography.
* `public/brands` contains the Boise company logos.
* `public/fonts` contains the local display and body fonts.

## Important implementation notes

The website is already complete. Claude Code should preserve the layout, spacing, typography, color system, imagery, copy, company URLs, telephone links, responsive rules, and matcher logic unless you request a specific change.

The five companies appear in this order, which is deliberate:

1. `https://boiseconstruction.co`
2. `https://boiseremodeling.co`
3. `https://boiseadu.co` (not built yet, launching soon)
4. `https://boisehandyman.co`
5. `https://boisecabinet.co`

Boise ADU Co has no website yet, so its calls to action use the telephone
number and it is labelled "Launching soon". Its panel uses a designed
plate rather than a photograph, because no ADU photography exists yet.

All logo artwork in `public/brands` is the supplied brand-kit artwork.
The header uses the P5 horizontal lockup and swaps to the icon mark below
560px, per the 200px minimum width in the brand guide.

The footer telephone link `(208) 477-1169` is the general P5 Home Co number.
