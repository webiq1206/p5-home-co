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
- `public/brands/` — the four Boise company logos
- `public/fonts/` — local display and body fonts

## Deployment

Deployment is configured in `.replit` as an autoscale target:

- build: `npm run build`
- run: `npm run start -- -H 0.0.0.0 -p ${PORT:-3000}`

Both commands are required. An earlier config set the deployment target
without a run command, which made publishing fail with "Could not find
run command".

## Gotchas

- All four companies now have live websites and each links to its own:
  `https://boiseconstruction.co`, `https://boiseremodeling.co`,
  `https://boisecabinet.co`, and `https://boisehandyman.co`. Boise
  Handyman Co launched on 2026-08-20; before that it was intentionally
  a telephone link labeled "Launching soon".
- The footer telephone link `(208) 477-1169` is the general P5 Home Co
  number and is not specific to Boise Handyman Co.
- Boise Handyman Co is the only company without a logo SVG in
  `public/brands/`. Its panel renders a text wordmark instead. This is
  intentional until a logo asset exists.
