/**
 * The questions for every project. Data only, and browser-safe.
 *
 * Each flow is a short list of questions; a question appears only when its
 * conditions hold. What each answer buys is in recipes.ts, on the server. A
 * question belongs here only if its answer changes the scope or the price:
 * a card that does not move a cost book line is a wasted tap.
 *
 * Size options state the typical dimensions they stand for, because those
 * dimensions are what the estimate is built from and the customer should be
 * able to see them.
 */

import type { ProjectFlow, TaskOption } from "./types.ts";

const HANDYMAN_TASKS: TaskOption[] = [
  { id: "faucet", group: "Plumbing", label: "Replace a faucet", hint: "You supply the faucet", max: 6 },
  { id: "toilet-repair", group: "Plumbing", label: "Fix a running toilet", max: 6 },
  { id: "toilet-replace", group: "Plumbing", label: "Replace a toilet", hint: "You supply the toilet", max: 6 },
  { id: "disposal", group: "Plumbing", label: "Replace a garbage disposal", hint: "You supply the disposal", max: 3 },
  { id: "caulk-tub", group: "Plumbing", label: "Re-caulk a tub or shower", max: 6 },
  { id: "light", group: "Electrical", label: "Swap a light fixture", hint: "You supply the fixture", max: 12 },
  { id: "fan", group: "Electrical", label: "Install a ceiling fan", hint: "Existing fan-rated box", max: 8 },
  { id: "outlet", group: "Electrical", label: "Replace an outlet or switch", max: 20 },
  { id: "gfci", group: "Electrical", label: "Replace a GFCI outlet", max: 12 },
  { id: "smoke", group: "Electrical", label: "Hardwired smoke or CO detector", max: 12 },
  { id: "patch-small", group: "Walls and paint", label: "Small drywall patch", hint: "Under 6 inches", max: 12 },
  { id: "patch-medium", group: "Walls and paint", label: "Medium drywall patch", hint: "1 to 2 square feet", max: 8 },
  { id: "paint-room", group: "Walls and paint", label: "Paint a room", hint: "Walls, about 12 x 12 ft", max: 10 },
  { id: "trim-caulk", group: "Walls and paint", label: "Caulk and paint trim in a room", max: 10 },
  { id: "door-hang", group: "Doors", label: "Hang an interior door", hint: "You supply the prehung door", max: 12 },
  { id: "door-adjust", group: "Doors", label: "Adjust a sticking door", max: 12 },
  { id: "weatherstrip", group: "Doors", label: "Weatherstrip an exterior door", max: 6 },
  { id: "hang-art", group: "Mounting", label: "Hang a picture or mirror", max: 20 },
  { id: "hang-heavy", group: "Mounting", label: "Hang a heavy mirror or art", max: 8 },
  { id: "shelf", group: "Mounting", label: "Install a shelf", max: 12 },
  { id: "blinds", group: "Mounting", label: "Install blinds or a curtain rod", max: 20 },
  { id: "grab-bar", group: "Mounting", label: "Install a grab bar", hint: "Blocked or anchored", max: 6 },
  { id: "furniture", group: "Mounting", label: "Assemble furniture", hint: "Per piece", max: 8 },
  { id: "fence-boards", group: "Outside", label: "Repair fence boards", hint: "Per section", max: 8 },
  { id: "fence-post", group: "Outside", label: "Replace a fence post", max: 8 },
  { id: "gate", group: "Outside", label: "Repair a gate", max: 4 },
  { id: "gutters-1", group: "Outside", label: "Clean gutters, one story", max: 1 },
  { id: "gutters-2", group: "Outside", label: "Clean gutters, two story", max: 1 },
  { id: "dryer-vent", group: "Outside", label: "Clean the dryer vent", max: 2 },
];

export const FLOWS: ProjectFlow[] = [
  // ------------------------------------------------------------------ remodel
  {
    id: "kitchen-remodel",
    group: "remodel",
    title: "Kitchen remodel",
    blurb: "Cabinets, counters, backsplash, plumbing and lighting",
    image: "project-kitchen",
    service: "kitchen",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "size",
        kind: "choice",
        prompt: "How big is your kitchen?",
        default: "medium",
        options: [
          { id: "small", label: "Small", hint: "About 100 sq ft, a galley or compact L", image: "kitchen-small" },
          { id: "medium", label: "Medium", hint: "About 150 sq ft, most Boise kitchens", image: "kitchen-medium" },
          { id: "large", label: "Large", hint: "About 250 sq ft with long cabinet runs", image: "kitchen-large" },
        ],
      },
      {
        id: "scope",
        kind: "choice",
        prompt: "What is the scope of your kitchen remodel?",
        default: "replace",
        options: [
          { id: "refresh", label: "Refresh", hint: "Paint the cabinets, new counters, backsplash and hardware", image: "kitchen-refresh" },
          { id: "replace", label: "New kitchen, same layout", hint: "New cabinets and finishes, everything stays where it is", image: "kitchen-replace" },
          { id: "redesign", label: "New layout", hint: "Move the sink, range or lighting to a new plan", image: "kitchen-redesign" },
        ],
      },
      {
        id: "island",
        kind: "choice",
        prompt: "Will your kitchen remodel include a new island?",
        default: "no",
        showIf: [{ q: "scope", notIn: ["refresh"] }],
        options: [
          { id: "no", label: "No island", hint: "Or keeping the one you have", image: "island-none" },
          { id: "yes", label: "Add an island", hint: "About 8 ft, with power and pendant lights", image: "island-add" },
        ],
      },
      {
        id: "counter",
        kind: "choice",
        prompt: "Which countertop material would you like?",
        default: "quartz",
        options: [
          { id: "quartz", label: "Quartz", hint: "Low maintenance, the most popular choice", image: "counter-quartz" },
          { id: "granite", label: "Granite", hint: "Natural stone, sealed", image: "counter-granite" },
          { id: "butcher", label: "Butcher block", hint: "Warm solid wood", image: "counter-butcher" },
          { id: "laminate", label: "Laminate", hint: "The budget-friendly option", image: "counter-laminate" },
        ],
      },
      {
        id: "floor",
        kind: "choice",
        prompt: "Will the project include new kitchen flooring?",
        default: "keep",
        options: [
          { id: "keep", label: "Keep my floor", image: "floor-keep" },
          { id: "lvp", label: "Luxury vinyl plank", hint: "Waterproof and durable", image: "floor-lvp" },
          { id: "hardwood", label: "Engineered hardwood", image: "floor-hardwood" },
          { id: "tile", label: "Tile", hint: "Porcelain or ceramic", image: "floor-tile" },
        ],
      },
      {
        id: "appliances",
        kind: "choice",
        prompt: "How should the appliances be handled?",
        default: "own",
        options: [
          { id: "own", label: "Keeping mine or buying my own", hint: "We still disconnect and reinstall them", image: "appliances-own" },
          { id: "package", label: "Include an appliance budget", hint: "An allowance at your finish level", image: "appliances-package" },
        ],
      },
    ],
  },
  {
    id: "bathroom-remodel",
    group: "remodel",
    title: "Bathroom remodel",
    blurb: "Shower or tub, tile, vanity, fixtures and lighting",
    image: "project-bathroom",
    service: "bathroom",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "bath",
        kind: "choice",
        prompt: "Which bathroom are you remodeling?",
        default: "hall",
        options: [
          { id: "powder", label: "Powder room", hint: "Toilet and sink, about 4 x 5 ft", image: "bath-powder" },
          { id: "hall", label: "Hall or guest bath", hint: "Full bath, about 5 x 8 ft", image: "bath-hall" },
          { id: "primary", label: "Primary bath", hint: "About 10 x 10 ft", image: "bath-primary" },
        ],
      },
      {
        id: "scope",
        kind: "choice",
        prompt: "What is the scope of your bathroom remodel?",
        default: "full",
        options: [
          { id: "refresh", label: "Refresh", hint: "New vanity, toilet, fixtures, lighting and paint", image: "bath-refresh" },
          { id: "full", label: "Full remodel, same layout", hint: "Down to the studs, everything stays where it is", image: "bath-full" },
          { id: "relocate", label: "Full remodel, new layout", hint: "Move the shower, toilet or vanity", image: "bath-relocate" },
        ],
      },
      {
        id: "bathing",
        kind: "choice",
        prompt: "Which tub or shower would you like?",
        default: "combo",
        showIf: [
          { q: "bath", notIn: ["powder"] },
          { q: "scope", notIn: ["refresh"] },
        ],
        options: [
          { id: "combo", label: "Tub with shower", hint: "New tub with tiled walls", image: "bathing-combo" },
          { id: "walkin", label: "Walk-in tiled shower", hint: "Tiled pan, glass enclosure", image: "bathing-walkin" },
          { id: "curbless", label: "Curbless shower", hint: "No step, linear drain, glass", image: "bathing-curbless" },
          { id: "both", label: "Freestanding tub and shower", hint: "Separate soaking tub and tiled shower", image: "bathing-both" },
        ],
      },
      {
        id: "vanity",
        kind: "choice",
        prompt: "Should the vanity have one sink or two?",
        default: "single",
        showIf: [{ q: "bath", notIn: ["powder"] }],
        options: [
          { id: "single", label: "Single vanity", hint: "24 to 36 inches", image: "vanity-single" },
          { id: "double", label: "Double vanity", hint: "60 to 72 inches", image: "vanity-double" },
        ],
      },
    ],
  },
  {
    id: "basement-finish",
    group: "remodel",
    title: "Basement finishing",
    blurb: "Turn an unfinished basement into living space",
    image: "project-basement",
    service: "remodel",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "sqft",
        kind: "number",
        prompt: "How many square feet of basement are you finishing?",
        unit: "sq ft",
        min: 200,
        max: 3000,
        step: 50,
        default: 800,
        presets: [400, 600, 800, 1000, 1200, 1500],
      },
      {
        id: "bath",
        kind: "choice",
        prompt: "Will your basement finishing project include a new bathroom?",
        default: "no",
        options: [
          { id: "no", label: "No bathroom", image: "basement-nobath" },
          { id: "yes", label: "Add a bathroom", hint: "Includes the sewage ejector pump a basement bathroom needs", image: "basement-bath" },
        ],
      },
      {
        id: "bar",
        kind: "choice",
        prompt: "Will your basement finishing project include a bar?",
        default: "no",
        options: [
          { id: "no", label: "No bar", image: "basement-nobar" },
          { id: "yes", label: "Add a basement bar", image: "basement-bar" },
        ],
      },
    ],
  },
  {
    id: "whole-home",
    group: "remodel",
    title: "Whole-home renovation",
    blurb: "Renovate the whole house in one project",
    image: "project-whole-home",
    service: "whole-home",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "sqft",
        kind: "number",
        prompt: "How many square feet of the home are being renovated?",
        help: "Finished living area included in the renovation.",
        unit: "sq ft",
        min: 600,
        max: 8000,
        step: 50,
        default: 2000,
        presets: [1200, 1600, 2000, 2400, 3000, 3600],
        prefill: "homeSqft",
      },
    ],
  },
  {
    id: "flooring",
    group: "remodel",
    title: "New flooring",
    blurb: "Vinyl plank, hardwood, carpet or tile, installed",
    image: "project-flooring",
    service: "remodel",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "material",
        kind: "choice",
        prompt: "Which flooring would you like installed?",
        default: "lvp",
        options: [
          { id: "lvp", label: "Luxury vinyl plank", hint: "Waterproof and durable", image: "floor-lvp" },
          { id: "hardwood", label: "Engineered hardwood", image: "floor-hardwood" },
          { id: "carpet", label: "Carpet", hint: "With new pad", image: "floor-carpet" },
          { id: "tile", label: "Tile", hint: "Porcelain or ceramic", image: "floor-tile" },
          { id: "laminate", label: "Laminate", image: "floor-laminate" },
        ],
      },
      {
        id: "sqft",
        kind: "number",
        prompt: "How many square feet of flooring do you need?",
        help: "A bedroom is about 150 sq ft. A main floor is often 800 to 1,200.",
        unit: "sq ft",
        min: 50,
        max: 5000,
        step: 25,
        default: 500,
        presets: [150, 300, 500, 800, 1200, 2000],
      },
      {
        id: "existing",
        kind: "choice",
        prompt: "What flooring is in place now?",
        default: "carpet",
        options: [
          { id: "carpet", label: "Carpet", image: "existing-carpet" },
          { id: "vinyl", label: "Vinyl or laminate", image: "existing-vinyl" },
          { id: "tile", label: "Tile", image: "existing-tile" },
          { id: "hardwood", label: "Hardwood", image: "existing-hardwood" },
          { id: "none", label: "Bare subfloor", hint: "Nothing to remove", image: "existing-none" },
        ],
      },
      {
        id: "baseboard",
        kind: "choice",
        prompt: "Should we install new baseboards?",
        default: "keep",
        options: [
          { id: "keep", label: "Keep my baseboards", image: "baseboard-keep" },
          { id: "new", label: "New baseboards", hint: "Painted, installed after the floor", image: "baseboard-new" },
        ],
      },
    ],
  },
  {
    id: "interior-paint",
    group: "remodel",
    title: "Interior painting",
    blurb: "Rooms painted by a professional crew",
    image: "project-paint",
    service: "remodel",
    estimateClass: "preliminary",
    usesFinish: false,
    questions: [
      {
        id: "rooms",
        kind: "number",
        prompt: "How many rooms need painting?",
        help: "Count each bedroom, bath, living area and hallway as one room.",
        unit: "rooms",
        min: 1,
        max: 20,
        step: 1,
        default: 4,
        presets: [1, 2, 4, 6, 8, 10],
      },
      {
        id: "ceilings",
        kind: "choice",
        prompt: "Should the ceilings be painted as well?",
        default: "no",
        options: [
          { id: "no", label: "Walls only", image: "paint-walls" },
          { id: "yes", label: "Walls and ceilings", image: "paint-ceilings" },
        ],
      },
      {
        id: "trim",
        kind: "choice",
        prompt: "Should the trim and baseboards be painted?",
        default: "no",
        options: [
          { id: "no", label: "Leave the trim", image: "paint-notrim" },
          { id: "yes", label: "Caulk and paint the trim", image: "paint-trim" },
        ],
      },
    ],
  },
  // ----------------------------------------------------------------- cabinets
  {
    id: "kitchen-cabinets",
    group: "cabinetry",
    title: "Kitchen cabinets",
    blurb: "New cabinets designed, built and installed",
    image: "project-cabinets",
    service: "cabinet-install",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "size",
        kind: "choice",
        prompt: "How big is your kitchen?",
        default: "medium",
        options: [
          { id: "small", label: "Small", hint: "About 14 ft of base cabinets", image: "kitchen-small" },
          { id: "medium", label: "Medium", hint: "About 20 ft of base cabinets", image: "kitchen-medium" },
          { id: "large", label: "Large", hint: "About 26 ft of base cabinets", image: "kitchen-large" },
        ],
      },
      {
        id: "uppers",
        kind: "choice",
        prompt: "How tall should the upper cabinets be?",
        default: "standard",
        options: [
          { id: "standard", label: "Standard uppers", hint: "30 to 36 inches tall", image: "uppers-standard" },
          { id: "stacked", label: "To the ceiling", hint: "Stacked or full-height uppers", image: "uppers-stacked" },
        ],
      },
      {
        id: "island",
        kind: "choice",
        prompt: "Will the project include island cabinets?",
        default: "no",
        options: [
          { id: "no", label: "No island", image: "island-none" },
          { id: "yes", label: "Island cabinets", hint: "About 8 ft", image: "island-add" },
        ],
      },
      {
        id: "counter",
        kind: "choice",
        prompt: "Should the estimate include countertops?",
        default: "none",
        options: [
          { id: "none", label: "Cabinets only", image: "counter-none" },
          { id: "quartz", label: "Quartz", image: "counter-quartz" },
          { id: "granite", label: "Granite", image: "counter-granite" },
          { id: "butcher", label: "Butcher block", image: "counter-butcher" },
          { id: "laminate", label: "Laminate", image: "counter-laminate" },
        ],
      },
      {
        id: "removal",
        kind: "choice",
        prompt: "Should we remove the existing cabinets?",
        default: "yes",
        options: [
          { id: "yes", label: "Yes, remove and haul away", image: "removal-yes" },
          { id: "no", label: "No, the space is ready", image: "removal-no" },
        ],
      },
    ],
  },
  {
    id: "bathroom-vanity",
    group: "cabinetry",
    title: "Bathroom vanity",
    blurb: "A new vanity with top, installed",
    image: "project-vanity",
    service: "cabinet-install",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "type",
        kind: "choice",
        prompt: "Which type of vanity would you like?",
        default: "single",
        options: [
          { id: "single", label: "Single vanity", hint: "24 to 36 inches, with top", image: "vanity-single" },
          { id: "double", label: "Double vanity", hint: "60 to 72 inches, with top", image: "vanity-double" },
          { id: "custom", label: "Custom built", hint: "Made to fit your wall", image: "vanity-custom" },
          { id: "floating", label: "Custom floating", hint: "Wall-hung, open below", image: "vanity-floating" },
        ],
      },
      {
        id: "width",
        kind: "number",
        prompt: "How wide should the vanity be?",
        unit: "ft",
        min: 2,
        max: 10,
        step: 1,
        default: 5,
        presets: [3, 4, 5, 6, 8],
        showIf: [{ q: "type", in: ["custom", "floating"] }],
      },
      {
        id: "removal",
        kind: "choice",
        prompt: "Should we remove the existing vanity?",
        default: "yes",
        options: [
          { id: "yes", label: "Yes, remove and haul away", image: "removal-yes" },
          { id: "no", label: "No, the space is ready", image: "removal-no" },
        ],
      },
      {
        id: "extras",
        kind: "choice",
        prompt: "Would you like additional bathroom storage?",
        default: "none",
        options: [
          { id: "none", label: "Just the vanity", image: "extras-none" },
          { id: "linen", label: "Linen tower", image: "extras-linen" },
          { id: "medicine", label: "Recessed medicine cabinet", image: "extras-medicine" },
        ],
      },
    ],
  },
  {
    id: "cabinet-refresh",
    group: "cabinetry",
    title: "Cabinet refresh",
    blurb: "Paint, reface or refinish the cabinets you have",
    image: "project-cabinet-refresh",
    service: "cabinet-install",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "method",
        kind: "choice",
        prompt: "How would you like your cabinets refreshed?",
        default: "paint",
        options: [
          { id: "paint", label: "Professional painting", hint: "Sprayed finish, your boxes and doors", image: "refresh-paint" },
          { id: "reface", label: "Refacing", hint: "New doors and drawer fronts, veneered boxes", image: "refresh-reface" },
          { id: "restain", label: "Restain or refinish", hint: "For solid wood cabinets", image: "refresh-restain" },
        ],
      },
      {
        id: "size",
        kind: "choice",
        prompt: "How large is the kitchen?",
        default: "medium",
        options: [
          { id: "small", label: "Small kitchen", hint: "About 26 ft of cabinets", image: "kitchen-small" },
          { id: "medium", label: "Medium kitchen", hint: "About 36 ft of cabinets", image: "kitchen-medium" },
          { id: "large", label: "Large kitchen", hint: "About 46 ft of cabinets", image: "kitchen-large" },
        ],
      },
      {
        id: "hardware",
        kind: "choice",
        prompt: "Should we install new pulls and knobs?",
        default: "yes",
        options: [
          { id: "yes", label: "Yes, new hardware", image: "hardware-yes" },
          { id: "no", label: "Keep mine", image: "hardware-no" },
        ],
      },
    ],
  },
  {
    id: "built-ins",
    group: "cabinetry",
    title: "Built-ins and storage",
    blurb: "Mudroom, laundry, closet, office and living room built-ins",
    image: "project-built-ins",
    service: "cabinet-install",
    estimateClass: "preliminary",
    usesFinish: true,
    questions: [
      {
        id: "type",
        kind: "choice",
        prompt: "Which built-in would you like?",
        default: "mudroom",
        options: [
          { id: "mudroom", label: "Mudroom lockers and bench", image: "builtin-mudroom" },
          { id: "laundry", label: "Laundry room cabinets", hint: "Uppers and base cabinets with a top", image: "builtin-laundry" },
          { id: "closet", label: "Walk-in closet system", image: "builtin-closet" },
          { id: "office", label: "Home office desk and uppers", image: "builtin-office" },
          { id: "bookshelves", label: "Built-in bookshelves", hint: "With lower doors", image: "builtin-bookshelves" },
          { id: "media", label: "Media wall", hint: "Full entertainment wall", image: "builtin-media" },
        ],
      },
      {
        id: "width",
        kind: "number",
        prompt: "How wide is the wall for the built-in?",
        unit: "ft",
        min: 3,
        max: 30,
        step: 1,
        default: 8,
        presets: [4, 6, 8, 10, 12, 16],
        showIf: [{ q: "type", notIn: ["media"] }],
      },
    ],
  },
  // ----------------------------------------------------------------- handyman
  {
    id: "handyman",
    group: "handyman",
    title: "Repairs and small jobs",
    blurb: "Tap everything on your list",
    image: "project-handyman",
    service: "handyman",
    estimateClass: "quote",
    usesFinish: false,
    questions: [{ id: "tasks", kind: "tasks", prompt: "Which jobs do you need done?", options: HANDYMAN_TASKS }],
  },
  // ------------------------------------------------------------- construction
  {
    id: "custom-home",
    group: "construction",
    title: "New home",
    blurb: "A custom home on your lot",
    image: "project-custom-home",
    service: "new-construction",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "sqft",
        kind: "number",
        prompt: "How many square feet of living space will the home have?",
        help: "Heated living area, not counting the garage.",
        unit: "sq ft",
        min: 800,
        max: 8000,
        step: 100,
        default: 2400,
        presets: [1600, 2000, 2400, 3000, 3600, 4500],
      },
      {
        id: "garage",
        kind: "choice",
        prompt: "Will the home have an attached garage?",
        default: "two",
        options: [
          { id: "none", label: "No garage", image: "garage-none" },
          { id: "two", label: "2-car", hint: "About 24 x 24 ft", image: "garage-two" },
          { id: "three", label: "3-car", hint: "About 36 x 24 ft", image: "garage-three" },
        ],
      },
      {
        id: "basement",
        kind: "choice",
        prompt: "Will the home have a basement?",
        default: "none",
        options: [
          { id: "none", label: "No basement", image: "basement-none" },
          { id: "unfinished", label: "Unfinished basement", hint: "Under about half of the home", image: "basement-unfinished" },
          { id: "finished", label: "Finished basement", hint: "Under about half of the home", image: "basement-finished" },
        ],
      },
    ],
  },
  {
    id: "addition",
    group: "construction",
    title: "Home addition",
    blurb: "Add rooms, a suite or a second story",
    image: "project-addition",
    service: "addition",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "type",
        kind: "choice",
        prompt: "What type of addition are you planning?",
        default: "room",
        options: [
          { id: "room", label: "Room addition", hint: "Bedroom, family room or office", image: "addition-room" },
          { id: "suite", label: "Primary suite", image: "addition-suite" },
          { id: "inlaw", label: "In-law suite", image: "addition-inlaw" },
          { id: "second", label: "Second story", image: "addition-second" },
          { id: "sunroom", label: "Sunroom", image: "addition-sunroom" },
          { id: "garage", label: "Attached garage", image: "addition-garage" },
        ],
      },
      {
        id: "sqft",
        kind: "number",
        prompt: "About how many square feet will the addition be?",
        unit: "sq ft",
        min: 100,
        max: 2000,
        step: 25,
        default: 300,
        presets: [150, 200, 300, 400, 600, 800],
        showIf: [{ q: "type", in: ["room", "sunroom", "garage"] }],
      },
    ],
  },
  {
    id: "garage-shop",
    group: "construction",
    title: "Detached garage or shop",
    blurb: "A new garage, shop or outbuilding",
    image: "project-garage",
    service: "new-construction",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "sqft",
        kind: "number",
        prompt: "How many square feet will the garage or shop be?",
        help: "A 2-car garage is about 576 sq ft. A 30 x 40 shop is 1,200.",
        unit: "sq ft",
        min: 200,
        max: 5000,
        step: 24,
        default: 576,
        presets: [576, 864, 1200, 1500, 2400],
      },
    ],
  },
  {
    id: "adu",
    group: "adu",
    title: "Accessory dwelling unit",
    blurb: "A second home on your property",
    image: "project-adu",
    service: "adu",
    estimateClass: "budgetary",
    usesFinish: true,
    questions: [
      {
        id: "type",
        kind: "choice",
        prompt: "Which type of ADU are you planning?",
        default: "detached",
        options: [
          { id: "detached", label: "Detached ADU", hint: "A new, separate building of about 600 sq ft", image: "adu-detached" },
          { id: "attached", label: "Attached ADU", hint: "Built onto your home", image: "adu-attached" },
          { id: "garage", label: "Garage conversion", hint: "Your existing garage becomes living space", image: "adu-garage" },
        ],
      },
    ],
  },
];

/**
 * The first question: what kind of project. Each flow's `group` is one of
 * these ids. A brand shows only the trades it has projects in, and a trade
 * with a single project goes straight to that project's questions.
 */
export const TRADES: { id: string; label: string; hint: string; image: string }[] = [
  { id: "remodel", label: "Remodel", hint: "Kitchens, baths, basements, floors and paint", image: "cat-remodel" },
  { id: "construction", label: "New construction", hint: "Homes, additions, garages and shops", image: "cat-construction" },
  { id: "adu", label: "ADU", hint: "A second home on your property", image: "cat-adu" },
  { id: "cabinetry", label: "Cabinetry", hint: "Kitchens, vanities and built-ins", image: "cat-cabinetry" },
  { id: "handyman", label: "Handyman", hint: "Repairs and small jobs", image: "cat-handyman" },
];

const BY_ID = new Map(FLOWS.map((f) => [f.id, f]));

export function flowById(id: string | null | undefined): ProjectFlow | null {
  return BY_ID.get(String(id ?? "")) ?? null;
}

/**
 * Where a link opens the estimator. `project` opens one project's questions; `trade` opens that
 * trade's list of projects, or the project itself when the brand offers only one in that trade.
 * Anything the brand does not offer is ignored, and the visitor starts at the first question.
 */
export function estimatorEntry(projects: string[], link: { project?: string | null; trade?: string | null }): { project: string | null; trade: string | null } {
  const offered = FLOWS.filter((f) => projects.includes(f.id));
  if (link.project && offered.some((f) => f.id === link.project)) return { project: link.project, trade: null };
  const inTrade = offered.filter((f) => f.group === link.trade);
  if (inTrade.length === 1) return { project: inTrade[0].id, trade: null };
  return { project: null, trade: inTrade.length > 1 ? String(link.trade) : null };
}
