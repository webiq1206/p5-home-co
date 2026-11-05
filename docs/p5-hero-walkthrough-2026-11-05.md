# P5 homepage walkthrough media

Focused homepage media replacement under Website Design Quality 2.3 and the
project-owned `docs/brand-profile.md`. The existing shared family hero, copy,
typography, quote CTA, layout and all other pages remain
owned by their current components. The P5-only wrapper adds decorative playback
without changing the shared family manifest or creating a cross-site rollout.

## Approved source

- Approved Library video: `libfile_abbbbb456cdc8191a50e2528c37adba6`, version 2.
- Deployment package: `libfile_4aa2d4696928819188abead18bcf6cc3`, version 1,
  `P5-Home-Co-Website-Video-Package.zip`, 18,650,949 bytes.
- ZIP SHA-256: `884cbe64a6a061708738e2013b51ea5385a8c29309cd37c366897024ed8e2d13`.
- Packaged 1080p MP4 is byte-identical to the approved version 2 video:
  SHA-256 `ab844d395c14bb6e0185b02f0a198e5d1c02ee6861356083d4116160829d5234`.
- 24 seconds, 30 fps, silent. Actual poster and video frames were inspected.
  Exterior, great room, kitchen, cabinetry and bathroom; no handyman footage.

The imagery is a generated design scene, not evidence of a completed P5 client
project. Its neutral hero placement and description make no customer-work claim.

## Loading and playback

The poster is eager, dimensioned and server rendered, including without JavaScript.
No video source is present until the eligible hero enters view. Phones/tablets
below 1024px and connections reporting 2G/3G select the 3.1 MB 720p MP4. Other
visitors select the 5.4 MB VP9 WebM where supported, otherwise the 9.8 MB 1080p
H.264 MP4. Selection occurs once per mount to avoid extra downloads on rotation.

Reduced motion and Save-Data show only the poster. Playback is muted, inline and
looping, with an accessible Play/Pause control. Scrolling away or hiding the page
pauses playback; explicit user pause persists on return. Load failure and blocked
autoplay retain the poster. A blocked browser can retry through the Play control.
The owner's latest direction requires full-bleed media across the entire hero on
all devices, superseding the earlier split composition. The poster and video fill
the complete hero. The latest owner direction permits darkening for readable text. The final
treatment replaces all earlier charcoal/text-region gradients and the failed
40% black trial with uniform black at 74% opacity, `rgba(0, 0, 0, 0.74)`,
meaning 26% transparency. There is no split column, opaque
reading panel or competing overlay. Obsolete text-region measurement is removed.

Phones use the current visible viewport minus the actual header, with no reserve
for the mobile action bar hidden over the hero. CSS dynamic viewport units and a
local measured VisualViewport/header enhancement count browser UI and safe areas
once. The hero uses a minimum height so larger text and short landscapes can grow
naturally without clipped content. No-JavaScript uses the same overlay and CSS
viewport fallback, including the known two-row narrow header.

Protected copy, typography and exact bronze remain. Actual-scene tests showed
black 0.72 failed and 0.73 barely passed; 0.74 provides a modest bright-frame/rounding
margin while retaining substantially more scene variation than qualifying
charcoal 0.94. Preserve the uniform treatment, full-fold geometry and visibly
present footage. Exact-final-source independent review and measured contrast
remain required; see brand profile 1.5 and the current final review.


## Release and recovery

Baseline GitHub main: `90661b20775f6a70af85ec1d5c911459d07326c6`.
Use the existing draft PR, independent rendered review, exact-head checks and
merge process. Jared owns Git import and publication in the existing Replit
project. A source merge does not publish the site. Verify the live hero and
critical quote/contact actions after owner publication.

Recovery is the baseline hero source at the commit above, including the preserved
`public/images/featured-boise-exterior.webp`. Revert the focused media change and
use the same owner-controlled publication route if needed.
