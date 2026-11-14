# Instant estimate Meta ads: copy and setup notes

Every line below follows the site wording rules: it is an instant preliminary
estimate (a price range on screen), never a quote or a final price, no stated
number of minutes, no promise about how fast a person replies, and no claim
that contact details are not needed.

Recommended Meta button: **Learn more**. Do not use "Get quote".

## What is in each brand folder

| File | Use |
|---|---|
| `<brand>-phone-*` | Dark hero. The real estimate screen on a phone, with the answers that built it. |
| `<brand>-three-steps-*` | Light. The three real screens side by side: pick, answer, see the range. |
| `<brand>-photo-card-*` | Photo led. A finished space with the example estimate card. |
| `carousel/<brand>-carousel-1..4` | Four card carousel: hook, then one card per step. Upload in order. |
| `video/<brand>-walkthrough-*` | About 12 seconds, silent. The real screens, tap by tap, ending on the button. |

Sizes: 1080x1080 (feed square), 1080x1350 (feed 4:5), 1080x1920 (Stories and
Reels, with the top and bottom kept clear for Meta's own interface).

The price ranges in the creatives are real output from the estimator for the
example answers shown, and each creative labels them as an example.

## Landing pages (with tracking)

The estimator already records utm values with each lead, so keep them on.

| Brand | Link |
|---|---|
| P5 Home Co | `https://p5homeco.com/estimator?utm_source=meta&utm_medium=paid_social&utm_campaign=instant_estimate&utm_content={{ad.name}}` |
| Boise Remodeling Co | `https://boiseremodeling.co/instant-estimate?utm_source=meta&utm_medium=paid_social&utm_campaign=instant_estimate&utm_content={{ad.name}}` |
| Boise Construction Co | `https://boiseconstruction.co/instant-estimate?utm_source=meta&utm_medium=paid_social&utm_campaign=instant_estimate&utm_content={{ad.name}}` |
| Boise Handyman Co | `https://boisehandyman.co/instant-estimate?utm_source=meta&utm_medium=paid_social&utm_campaign=instant_estimate&utm_content={{ad.name}}` |
| Boise Cabinet Co | `https://boisecabinet.co/instant-estimate?utm_source=meta&utm_medium=paid_social&utm_campaign=instant_estimate&utm_content={{ad.name}}` |

To open the estimator on one project, add `&project=` with one of:
remodeling `kitchen-remodel`, `bathroom-remodel`, `basement-finish`,
`whole-home`, `flooring`, `interior-paint`, `addition`; construction
`custom-home`, `addition`, `garage-shop`, `adu`; handyman `handyman`,
`interior-paint`, `flooring`; cabinet `kitchen-cabinets`, `bathroom-vanity`,
`cabinet-refresh`, `built-ins`.

## P5 Home Co

Primary text
1. Wondering what your project could cost? Answer a few questions and see a personalized preliminary price range on screen. Free, open day or night, and no appointment needed.
2. Remodel, new build, cabinets or a repair list. Pick your project, answer a few questions, and see your preliminary price range in minutes.
3. Start with a budget range, then decide who to call. Our instant estimate is free and you can run it any time.

Headlines
* See what your project could cost
* Your instant estimate, in minutes
* Know your budget range first

Description: Free. No appointment. Day or night.

## Boise Remodeling Co

Primary text
1. Thinking about a new kitchen, bath or basement? Answer a few questions and see a personalized preliminary price range for your remodel, right on screen.
2. Know your remodel budget range before you talk to a contractor. Free, no appointment, any time of day.
3. Pick your project. Answer a few questions. See your price range. Planning a remodel in the Treasure Valley can start this simply.

Headlines
* See what your remodel could cost
* Instant remodel estimate, in minutes
* Know your budget range first

Description: Free. No appointment. Day or night.

## Boise Construction Co

Primary text
1. Thinking about building? Tell us the size and finish level you have in mind and see a preliminary budget range for your new home on screen.
2. Custom home, addition, garage, shop or ADU. Answer a few questions and see a preliminary price range in minutes. Free, with no appointment.
3. Start your build with a budget range in hand. Our instant estimate is open day or night.

Headlines
* See what your new home could cost
* Instant build estimate, in minutes
* Start with a budget range

Description: Free. No appointment. Day or night.

## Boise Handyman Co

Primary text
1. That repair list has a price range. Tap the jobs you need done and see a preliminary estimate on screen, in minutes.
2. Leaky faucet, sticky door, a shelf that needs hanging. Add your jobs and see what the list could cost. Free, no appointment.
3. No waiting for a callback to find out what your repairs could cost. Build your list and see your preliminary price range any time.

Headlines
* See what your repair list could cost
* Instant handyman estimate
* Add your jobs, see your range

Description: Free. No appointment. Day or night.

## Boise Cabinet Co

Primary text
1. New cabinets? Tell us your kitchen size, cabinet height and finish level, and see a preliminary price range on screen in minutes.
2. See your cabinet budget range before you visit a showroom or talk to a contractor. Free, no appointment, day or night.
3. Kitchen cabinets, a bathroom vanity, a refresh or built-ins. Pick your project and see what it could cost.

Headlines
* See what new cabinets could cost
* Instant cabinet estimate, in minutes
* See your budget range first

Description: Free. No appointment. Day or night.

## Before launch

* Meta may ask whether these belong in the Housing special ad category, which
  limits targeting. Check Meta's current definition when you set up the campaign.
* Meta lead tracking is not the same on every site yet. Boise Construction Co
  and Boise Handyman Co send a Meta Lead event when a visitor finishes the
  estimator. Boise Remodeling Co and Boise Cabinet Co have the Meta pixel but
  do not send Lead for the estimator yet (they send it to Google only), and
  p5homeco.com has no Meta pixel. Until that is added, those three campaigns
  cannot optimize for leads.
* Suggested test: one ad set per brand, the three stills plus the video, and let
  Meta rotate placements. The video and the three-steps image show the tool most
  directly; the photo card is the warmest.
