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

All four company calls to action point to their live websites:

* `https://boiseconstruction.co`
* `https://boiseremodeling.co`
* `https://boisecabinet.co`
* `https://boisehandyman.co`

The footer telephone link `(208) 477-1169` is the general P5 Home Co number.
