// Generated from scripts/p5-boise-rate-card.json by scripts/p5-build-rate-card.mjs. Do not edit by hand.
import type {PlanningRate} from './planningBooks.ts';
/** Direct costs only, Boise / Treasure Valley, Idaho. No overhead, profit, contingency or trip charge is included in any line: the estimator's own calculation adds those once per job after direct costs. Labor lines are the crew cost of the incremental work while a crew is already on site. Material lines are delivered material cost. Owner reviews and adjusts; every line is a planning average, not a quote. */
export const RATE_CARD_SOURCE="Boise / Treasure Valley planning averages, reviewed 2026-09-20";
export const RATE_CARD:PlanningRate[]=[
 {
  "code": "RC-LAB-GENERAL",
  "description": "General carpenter / handyman labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 68,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-HELPER",
  "description": "Laborer / helper, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 46,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-ELECTRICAL",
  "description": "Electrician labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 92,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-PLUMBING",
  "description": "Plumber labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-HVAC",
  "description": "HVAC technician labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 88,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-ROOFING",
  "description": "Roofer labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-MASON",
  "description": "Mason labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-PAINTER",
  "description": "Painter labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 58,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-DRYWALL",
  "description": "Drywall finisher labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 62,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-TILE",
  "description": "Tile setter labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-FLOORING",
  "description": "Flooring installer labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-CONCRETE",
  "description": "Concrete finisher labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-FRAMING",
  "description": "Framing carpenter labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 70,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-INSULATION",
  "description": "Insulation installer labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 58,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-LANDSCAPE",
  "description": "Landscape / irrigation labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 56,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-CABINET",
  "description": "Cabinet installer labor, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-LAB-CRAWL",
  "description": "Confined-space crawl-space labor premium, crew cost per hour",
  "type": "Labor",
  "unit": "HR",
  "amount": 78,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-RECEP-M",
  "description": "Standard 15/20A receptacle, cover and connectors, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 6,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-RECEP-L",
  "description": "Replace one standard receptacle in an existing box, test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-GFCI-M",
  "description": "GFCI receptacle and cover, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 26,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-GFCI-L",
  "description": "Replace one receptacle with GFCI in an existing box, test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-GFCI-WP-M",
  "description": "Exterior weather-resistant GFCI receptacle with in-use bubble cover, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-GFCI-WP-L",
  "description": "Replace one exterior receptacle with weather-resistant GFCI and in-use cover, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 62,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-SWITCH-M",
  "description": "Standard or dimmer switch with plate, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 12,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-SWITCH-L",
  "description": "Replace one switch in an existing box, test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-GROUND-L",
  "description": "Diagnose an open ground at one receptacle and correct it where the circuit is accessible, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-BREAKER-M",
  "description": "Standard 15/20A circuit breaker, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-BREAKER-GFCI-M",
  "description": "GFCI or AFCI circuit breaker, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 68,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-BREAKER-L",
  "description": "Replace one breaker in an existing panel, de-energize, test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 92,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-FIXTURE-M",
  "description": "Builder-grade interior light fixture, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-FIXTURE-EXT-M",
  "description": "Builder-grade exterior light fixture, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-FIXTURE-L",
  "description": "Replace one light fixture at an existing box, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 68,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-CANLIGHT-M",
  "description": "Retrofit LED recessed light, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-CANLIGHT-L",
  "description": "Install one retrofit LED recessed light in an existing opening, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 45,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-FAN-M",
  "description": "Ceiling fan with light, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-FAN-L",
  "description": "Install one ceiling fan on an existing rated box, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-DIAG-L",
  "description": "Diagnose one dead circuit, fixture or outlet group and identify the fault, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-CIRCUIT-L",
  "description": "Run one new 20A branch circuit up to 40 feet in accessible framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 420,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-CIRCUIT-M",
  "description": "Cable, box, breaker and devices for one new 20A branch circuit, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 115,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-PANEL-M",
  "description": "200A residential load center with breakers, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 850,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-PANEL-L",
  "description": "Replace one residential panel, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1450,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-SMOKE-M",
  "description": "Combination smoke and carbon monoxide alarm, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-SMOKE-L",
  "description": "Replace one interconnected alarm at an existing base, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-BOND-L",
  "description": "Correct bonding or grounding at the service or a subpanel, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-PTRAP-M",
  "description": "P-trap assembly, tailpiece and washers for one sink, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-PTRAP-L",
  "description": "Reconfigure or replace one under-sink trap assembly, leak test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-VACBREAK-M",
  "description": "Hose bib vacuum breaker, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 12,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-VACBREAK-L",
  "description": "Install one hose bib vacuum breaker and test, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 28,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-HOSEBIB-M",
  "description": "Frost-free hose bib, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-HOSEBIB-L",
  "description": "Replace one exterior hose bib, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-FAUCET-M",
  "description": "Builder-grade kitchen or lavatory faucet, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-FAUCET-L",
  "description": "Replace one faucet and supply connections, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 155,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-TOILET-M",
  "description": "Builder-grade toilet with wax ring and supply, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 265,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-TOILET-L",
  "description": "Replace one toilet, set and seal, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 175,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SHUTOFF-M",
  "description": "Quarter-turn angle stop and supply line, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SHUTOFF-L",
  "description": "Replace one fixture shutoff valve, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 68,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-DISPOSAL-M",
  "description": "Garbage disposal, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 155,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-DISPOSAL-L",
  "description": "Replace one garbage disposal, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-DRAINCLEAR-L",
  "description": "Clear one branch drain line with a cable machine, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 210,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-LEAK-L",
  "description": "Diagnose and repair one accessible supply or drain leak, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-WH-M",
  "description": "50-gallon gas or electric water heater with fittings, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 1150,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-WH-L",
  "description": "Replace one water heater in the same location, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-EXPTANK-M",
  "description": "Thermal expansion tank, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 78,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-PRV-M",
  "description": "Pressure-reducing valve, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-PRV-L",
  "description": "Replace one pressure-reducing valve, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 245,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SUMP-M",
  "description": "Sump pump with check valve, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SUMP-L",
  "description": "Replace one sump pump in an existing basin, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SHOWERVALVE-M",
  "description": "Pressure-balancing shower valve and trim, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-SHOWERVALVE-L",
  "description": "Replace one shower valve with access, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 465,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-BATHFAN-M",
  "description": "Bath exhaust fan, 80 to 110 CFM, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 115,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-BATHFAN-L",
  "description": "Replace one bath exhaust fan in an existing opening, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-VENTDUCT-M",
  "description": "Insulated flexible exhaust duct, clamps and tape, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 6,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-VENTDUCT-L",
  "description": "Route exhaust duct in accessible attic or crawl space, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 11,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-VENTTERM-M",
  "description": "Exterior exhaust termination cap with damper and flashing, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-VENTTERM-L",
  "description": "Cut in and weatherproof one exterior exhaust termination, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-DRYERVENT-L",
  "description": "Correct or reroute one dryer vent to a compliant exterior termination, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-REGISTER-M",
  "description": "Supply or return register, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-DUCTSEAL-L",
  "description": "Seal accessible duct joints with mastic, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 7,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-THERMOSTAT-M",
  "description": "Programmable thermostat, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-THERMOSTAT-L",
  "description": "Replace one thermostat, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-SERVICE-L",
  "description": "Diagnose one heating or cooling fault, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 175,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-VENTBOOT-M",
  "description": "Plumbing vent roof boot with fasteners and sealant, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-VENTBOOT-L",
  "description": "Replace one plumbing vent roof boot and seal into existing roofing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-SHINGLE-M",
  "description": "Architectural shingles, underlayment and fasteners, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 1.95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-SHINGLE-L",
  "description": "Tear off and install architectural shingles, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 2.55,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-PATCH-L",
  "description": "Localized shingle repair up to about 25 square feet, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-FLASH-M",
  "description": "Step, wall or chimney flashing and sealant, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 7,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-FLASH-L",
  "description": "Replace or reseal flashing, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 16,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-FLASHCLEAN-L",
  "description": "Clean accumulated debris and buildup from a chimney base and its flashing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-CHIMCAP-M",
  "description": "Chimney crown repair mortar, sealant and bond coat, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-CHIMCAP-L",
  "description": "Patch and seal cracking in one chimney crown or cap, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 485,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-CHIMREBUILD-L",
  "description": "Rebuild one chimney crown or cap, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1450,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-CHIMCAPSTAIN-M",
  "description": "Stainless rain cap and spark arrestor, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 175,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-GUTTER-M",
  "description": "Seamless aluminum gutter, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 6,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-GUTTER-L",
  "description": "Install seamless gutter, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 7,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-DOWNSPOUT-M",
  "description": "Downspout with elbows and straps, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-DOWNSPOUT-L",
  "description": "Install one downspout, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-GUTTERCLEAN-L",
  "description": "Clean gutters and downspouts, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 2.2,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-ATTICVENT-M",
  "description": "Roof or gable attic vent, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROOF-ATTICVENT-L",
  "description": "Install one attic vent, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 145,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-DEBRIS-L",
  "description": "Remove accumulated nonhazardous debris from a crawl space, labor per square foot of crawl area",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.15,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-VB-M",
  "description": "6-mil crawl-space vapor barrier with seam tape and fasteners, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 0.42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-VB-L",
  "description": "Install crawl-space ground vapor barrier with lapped, sealed seams, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.15,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-INSUL-M",
  "description": "R-30 floor insulation batts with supports, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 1.05,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-INSUL-L",
  "description": "Install floor insulation between joists from below, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-VENT-M",
  "description": "Foundation vent or vent cover, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 26,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-VENT-L",
  "description": "Replace one foundation vent, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-ACCESS-L",
  "description": "Repair or replace one crawl-space access door or hatch, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-POSTJACK-M",
  "description": "Adjustable steel post or jack with pad, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 115,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CRAWL-POSTJACK-L",
  "description": "Install one supplemental support post in a crawl space, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 385,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSUL-ATTIC-M",
  "description": "Blown attic insulation to R-49, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 0.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSUL-ATTIC-L",
  "description": "Blow attic insulation, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.55,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSUL-WALL-M",
  "description": "R-15 wall batt insulation, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 0.78,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSUL-WALL-L",
  "description": "Install wall batt insulation, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.62,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSUL-AIRSEAL-L",
  "description": "Air-seal accessible attic or crawl penetrations, labor per square foot of area",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DRY-BOARD-M",
  "description": "Drywall board, tape, compound and fasteners, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 0.72,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DRY-BOARD-L",
  "description": "Hang and finish drywall to a level 4 finish, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 2.15,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DRY-PATCH-L",
  "description": "Patch and texture one drywall repair up to about 4 square feet, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DRY-TEXTURE-L",
  "description": "Match existing wall or ceiling texture, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-INT-M",
  "description": "Interior paint and sundries, material per square foot of surface",
  "type": "Material",
  "unit": "SF",
  "amount": 0.28,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-INT-L",
  "description": "Prep and paint interior walls and ceilings, two coats, labor per square foot of surface",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-EXT-M",
  "description": "Exterior paint, primer and sundries, material per square foot of surface",
  "type": "Material",
  "unit": "SF",
  "amount": 0.38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-EXT-L",
  "description": "Prep and paint exterior siding and trim, labor per square foot of surface",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.35,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-TRIM-L",
  "description": "Prep and paint trim, doors or baseboard, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 2.65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-CAULK-L",
  "description": "Caulk and seal joints, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 1.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-BASE-M",
  "description": "Painted MDF or pine baseboard, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 2.35,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-BASE-L",
  "description": "Install baseboard, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 3.35,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-CASE-M",
  "description": "Door or window casing, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 2.65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-CASE-L",
  "description": "Install casing, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 3.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-CROWN-M",
  "description": "Crown moulding, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 4.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-CROWN-L",
  "description": "Install crown moulding, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 6.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-SHELF-M",
  "description": "Closet shelf and rod set, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 58,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-SHELF-L",
  "description": "Install one closet shelf and rod, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-HANDRAIL-M",
  "description": "Handrail with brackets, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 16,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-HANDRAIL-L",
  "description": "Install handrail, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-INT-M",
  "description": "Prehung hollow-core interior door with hardware, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 215,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-INT-L",
  "description": "Install one prehung interior door, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-EXT-M",
  "description": "Prehung insulated exterior door with hardware, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 875,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-EXT-L",
  "description": "Install one prehung exterior door, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 485,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-SLAB-L",
  "description": "Rehang, plane or adjust one existing door, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-HARDWARE-M",
  "description": "Passage, privacy or entry lockset, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 58,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-HARDWARE-L",
  "description": "Install one lockset or deadbolt, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-WEATHER-M",
  "description": "Weatherstripping and threshold, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-WEATHER-L",
  "description": "Replace weatherstripping or threshold at one door, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-GARAGEOP-M",
  "description": "Garage door opener with rail and remotes, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 385,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-GARAGEOP-L",
  "description": "Install one garage door opener, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 295,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DOOR-GARAGESERV-L",
  "description": "Service one garage door: springs, rollers, balance and safety reverse, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-WIN-VINYL-M",
  "description": "Vinyl replacement window, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-WIN-VINYL-L",
  "description": "Install one vinyl replacement window in an existing opening, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 365,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-WIN-GLASS-L",
  "description": "Replace one insulated glass unit in an existing sash, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 265,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-WIN-SCREEN-M",
  "description": "Window screen, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-WIN-SEAL-L",
  "description": "Reseal or re-caulk one window perimeter, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 78,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-BASE-M",
  "description": "Stock or semi-custom base cabinetry, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 235,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-BASE-L",
  "description": "Install base cabinetry, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 62,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-UPPER-M",
  "description": "Stock or semi-custom wall cabinetry, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-UPPER-L",
  "description": "Install wall cabinetry, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 58,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-TALL-M",
  "description": "Stock or semi-custom tall cabinetry, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 395,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-TALL-L",
  "description": "Install tall cabinetry, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 88,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-VANITY-M",
  "description": "Bathroom vanity cabinet, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 265,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-HARDWARE-M",
  "description": "Cabinet pull or knob, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 6,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-HARDWARE-L",
  "description": "Install one cabinet pull or knob, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 8,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-HINGE-L",
  "description": "Adjust or replace hardware and align one cabinet door or drawer, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-REFACE-M",
  "description": "Cabinet refacing veneer, doors and drawer fronts, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 175,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CAB-REFACE-L",
  "description": "Reface existing cabinetry, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 95,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-QUARTZ-M",
  "description": "Quartz countertop fabricated and delivered, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 62,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-GRANITE-M",
  "description": "Granite countertop fabricated and delivered, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 56,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-LAMINATE-M",
  "description": "Laminate countertop, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 24,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-BUTCHER-M",
  "description": "Butcher block countertop, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-INSTALL-L",
  "description": "Template, set and seal countertop, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CTOP-SINKCUT-L",
  "description": "Undermount sink cutout and polish, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-FLOOR-M",
  "description": "Porcelain or ceramic floor tile, thinset and grout, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 6.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-FLOOR-L",
  "description": "Set floor tile over prepared substrate, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 9.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-WALL-M",
  "description": "Wall or shower tile, thinset and grout, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 7.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-WALL-L",
  "description": "Set wall or shower tile, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 13.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-BACKSPLASH-M",
  "description": "Backsplash tile, thinset and grout, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 9.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-BACKSPLASH-L",
  "description": "Set backsplash tile, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 16,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-WATERPROOF-M",
  "description": "Shower waterproofing membrane and sealant, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 3.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-WATERPROOF-L",
  "description": "Install shower waterproofing, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 4.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TILE-REGROUT-L",
  "description": "Regrout and reseal tile, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 5.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-LVP-M",
  "description": "Luxury vinyl plank with underlayment, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 3.45,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-LVP-L",
  "description": "Install luxury vinyl plank, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 2.65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-HARDWOOD-M",
  "description": "Engineered or solid hardwood flooring, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 7.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-HARDWOOD-L",
  "description": "Install hardwood flooring, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 4.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-CARPET-M",
  "description": "Carpet with pad, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 3.15,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-CARPET-L",
  "description": "Install carpet and pad, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.35,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-PREP-L",
  "description": "Level, patch and prepare subfloor, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-DEMO-L",
  "description": "Remove existing floor covering, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 1.45,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-SQUEAK-L",
  "description": "Correct squeaks or loose subfloor in one accessible area, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FRAME-LUMBER-M",
  "description": "Framing lumber, fasteners and hardware, material per square foot of framed area",
  "type": "Material",
  "unit": "SF",
  "amount": 4.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FRAME-WALL-L",
  "description": "Frame interior or exterior wall, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FRAME-REPAIR-L",
  "description": "Repair or sister damaged framing in one accessible area, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 385,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FRAME-HEADER-L",
  "description": "Install one structural header in an existing wall, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 985,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FRAME-SHEATH-M",
  "description": "Wall or roof sheathing, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 1.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-FLATWORK-M",
  "description": "Concrete, mesh and forms for flatwork, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 4.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-FLATWORK-L",
  "description": "Form, pour and finish concrete flatwork, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 5.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-FOOTING-M",
  "description": "Footing concrete and reinforcement, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 16,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-FOOTING-L",
  "description": "Excavate, form and pour footing, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 26,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-CRACK-L",
  "description": "Route and seal concrete cracks, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 14,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CONC-DEMO-L",
  "description": "Break out and remove existing concrete, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 4.75,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-MASON-REPOINT-L",
  "description": "Repoint masonry mortar joints, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-MASON-BRICK-M",
  "description": "Brick or block with mortar, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 11,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SIDE-LAP-M",
  "description": "Fiber cement or engineered lap siding, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 3.65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SIDE-LAP-L",
  "description": "Install lap siding, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 4.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SIDE-REPAIR-L",
  "description": "Replace damaged siding in one localized area, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SIDE-TRIM-M",
  "description": "Exterior trim board, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 4.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SIDE-SOFFIT-L",
  "description": "Repair or replace soffit and fascia, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 14,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-FRAME-M",
  "description": "Deck framing lumber, hardware and footings, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 12,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-FRAME-L",
  "description": "Frame deck structure, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 14,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-BOARD-M",
  "description": "Composite or cedar decking, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 9.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-BOARD-L",
  "description": "Install decking, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 6.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-RAIL-M",
  "description": "Deck railing, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DECK-RAIL-L",
  "description": "Install deck railing, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 28,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FENCE-CEDAR-M",
  "description": "Cedar privacy fence, posts and hardware, material per linear foot",
  "type": "Material",
  "unit": "LF",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FENCE-CEDAR-L",
  "description": "Install cedar privacy fence, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FENCE-REPAIR-L",
  "description": "Repair one fence section, post or gate, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-PUMP-M",
  "description": "Residential irrigation booster or shallow-well pump, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 685,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-PUMP-L",
  "description": "Install one irrigation pump with electrical and plumbing connections, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-HEAD-M",
  "description": "Irrigation spray or rotor head, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 14,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-HEAD-L",
  "description": "Replace one irrigation head, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-VALVE-M",
  "description": "Irrigation zone valve, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-VALVE-L",
  "description": "Replace one irrigation zone valve, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 145,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-BACKFLOW-L",
  "description": "Test or repair one backflow assembly, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-IRR-LINE-L",
  "description": "Repair one broken irrigation line, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-IGNITION-M",
  "description": "Gas fireplace ignition components: pilot assembly, thermocouple, igniter, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-IGNITION-L",
  "description": "Diagnose one fireplace and install ignition components, test operation, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-GLASSDOOR-M",
  "description": "Fireplace glass door set, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 565,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-GLASSDOOR-L",
  "description": "Fit and install one fireplace glass door set, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-DAMPER-L",
  "description": "Remove or lock open one fireplace damper, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 165,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FIRE-SWEEP-L",
  "description": "Inspect and sweep one chimney flue, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 265,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-APPL-INSTALL-L",
  "description": "Install one owner-supplied appliance with existing connections, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-APPL-RANGEHOOD-M",
  "description": "Range hood, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-APPL-RANGEHOOD-L",
  "description": "Install one range hood with existing duct, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 195,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DEMO-INTERIOR-L",
  "description": "Selective interior demolition, labor per square foot of affected area",
  "type": "Labor",
  "unit": "SF",
  "amount": 2.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DISP-DUMPSTER",
  "description": "Dumpster delivery, haul-off and tipping fees, 10 to 20 cubic yards, each",
  "type": "Equipment",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DISP-TRUCKLOAD",
  "description": "Pickup or trailer load of debris hauled and dumped, each",
  "type": "Equipment",
  "unit": "EA",
  "amount": 185,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DISP-BAGGED",
  "description": "Bagged debris removal and disposal, each",
  "type": "Equipment",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-EQ-LIFT-DAY",
  "description": "Scissor or boom lift rental, per day",
  "type": "Equipment",
  "unit": "EA",
  "amount": 385,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-EQ-SCAFFOLD-DAY",
  "description": "Scaffold section rental, per day",
  "type": "Equipment",
  "unit": "EA",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-EQ-EXCAVATOR-DAY",
  "description": "Mini excavator or skid steer with operator, per day",
  "type": "Equipment",
  "unit": "EA",
  "amount": 785,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-EQ-DUSTBARRIER-L",
  "description": "Erect dust containment and floor protection, labor per square foot of work area",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-CLEAN-FINAL-L",
  "description": "Final construction clean, labor per square foot of work area",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.55,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PERMIT-RESIDENTIAL",
  "description": "Residential building permit and plan review fees, typical remodel, each",
  "type": "Other",
  "unit": "EA",
  "amount": 485,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PERMIT-TRADE",
  "description": "Single trade permit fee, each",
  "type": "Other",
  "unit": "EA",
  "amount": 115,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-MOB-SERVICE",
  "description": "Crew mobilization for one service visit, applied once per job",
  "type": "Labor",
  "unit": "EA",
  "amount": 135,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-INSPECT-SITE-L",
  "description": "Site inspection and documentation for an item that cannot be quantified from the description, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 145,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-TUBSHOWER-M",
  "description": "Alcove tub with valve and surround, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 985,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-TUBSHOWER-L",
  "description": "Set alcove tub and surround, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 985,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-SHOWERPAN-M",
  "description": "Shower pan or base with drain, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 565,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-SHOWERPAN-L",
  "description": "Set shower pan and drain, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 485,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-GLASS-M",
  "description": "Frameless shower glass enclosure, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 1850,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-GLASS-L",
  "description": "Measure and install shower glass, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 465,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-ACCESSORY-M",
  "description": "Towel bar, paper holder or grab bar, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 42,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-ACCESSORY-L",
  "description": "Install one bath accessory with blocking, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BATH-EXHAUSTRUN-L",
  "description": "Vent one bath fan to a new exterior termination, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 385,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-KIT-SINK-M",
  "description": "Kitchen sink, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 465,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-KIT-SINK-L",
  "description": "Set kitchen sink and connect, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 265,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-KIT-ISLAND-L",
  "description": "Build and set a cabinet island, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 685,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-PLUMB-M",
  "description": "Supply, drain and vent rough-in materials per fixture",
  "type": "Material",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-PLUMB-L",
  "description": "Rough in one plumbing fixture in accessible framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-ELEC-M",
  "description": "Wire, boxes and devices per electrical rough-in point",
  "type": "Material",
  "unit": "EA",
  "amount": 38,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-ELEC-L",
  "description": "Rough in one electrical point in accessible framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-HVAC-M",
  "description": "Duct, register and fittings per conditioned room",
  "type": "Material",
  "unit": "EA",
  "amount": 315,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ROUGH-HVAC-L",
  "description": "Rough in duct to one room, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 425,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-FOUNDATION-M",
  "description": "Foundation concrete, rebar and forms, material per square foot of footprint",
  "type": "Material",
  "unit": "SF",
  "amount": 9.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-FOUNDATION-L",
  "description": "Excavate, form and pour foundation, labor per square foot of footprint",
  "type": "Labor",
  "unit": "SF",
  "amount": 11,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-FRAMESHELL-M",
  "description": "Framing package for floor, wall and roof, material per square foot of floor",
  "type": "Material",
  "unit": "SF",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-FRAMESHELL-L",
  "description": "Frame the shell, labor per square foot of floor",
  "type": "Labor",
  "unit": "SF",
  "amount": 18,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-ROOFSYSTEM-M",
  "description": "Roofing system over a new shell, material per square foot of floor",
  "type": "Material",
  "unit": "SF",
  "amount": 6.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-ROOFSYSTEM-L",
  "description": "Install roofing over a new shell, labor per square foot of floor",
  "type": "Labor",
  "unit": "SF",
  "amount": 5.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-ENVELOPE-M",
  "description": "Windows, exterior doors and weather barrier, material per square foot of floor",
  "type": "Material",
  "unit": "SF",
  "amount": 14,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-ENVELOPE-L",
  "description": "Install windows, exterior doors and weather barrier, labor per square foot of floor",
  "type": "Labor",
  "unit": "SF",
  "amount": 7.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-MECHANICAL-L",
  "description": "Complete mechanical, electrical and plumbing rough and trim, labor per square foot of floor",
  "type": "Labor",
  "unit": "SF",
  "amount": 28,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-INTERIOR-M",
  "description": "Interior finish package: drywall, trim, paint and floors, material per square foot of floor",
  "type": "Material",
  "unit": "SF",
  "amount": 26,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-INTERIOR-L",
  "description": "Install the interior finish package, labor per square foot of floor",
  "type": "Labor",
  "unit": "SF",
  "amount": 31,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-GARAGE-M",
  "description": "Garage shell and slab, material per square foot of garage",
  "type": "Material",
  "unit": "SF",
  "amount": 34,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-GARAGE-L",
  "description": "Build garage shell and slab, labor per square foot of garage",
  "type": "Labor",
  "unit": "SF",
  "amount": 26,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-COVERED-M",
  "description": "Covered patio or porch structure, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 28,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-BUILD-COVERED-L",
  "description": "Build covered patio or porch, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 22,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SITE-UTILITY-L",
  "description": "Trench and run one utility service to a new structure, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 3850,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SITE-SEPTIC",
  "description": "Septic system, permitted and installed, each",
  "type": "Subcontractor",
  "unit": "EA",
  "amount": 16500,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SITE-WELL",
  "description": "Drilled well with pump, each",
  "type": "Subcontractor",
  "unit": "EA",
  "amount": 22500,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SITE-DRIVEWAY-M",
  "description": "Driveway gravel or concrete, material per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 5.25,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-SITE-GRADE-L",
  "description": "Rough and finish grading, labor per square foot of lot area worked",
  "type": "Labor",
  "unit": "SF",
  "amount": 0.85,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-SERVICE-L",
  "description": "Upgrade or relocate the electrical service entrance, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1950,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-EVCHARGER-M",
  "description": "Level 2 EV charger circuit materials, each",
  "type": "Material",
  "unit": "EA",
  "amount": 285,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-ELEC-EVCHARGER-L",
  "description": "Install one EV charger circuit, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 485,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-REPIPE-L",
  "description": "Repipe one fixture group in accessible walls, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 985,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PLUM-GASLINE-L",
  "description": "Run one gas line to an appliance in accessible framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-FURNACE-M",
  "description": "Residential furnace, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 2450,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-FURNACE-L",
  "description": "Replace one furnace in the same location, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1250,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-AC-M",
  "description": "Air conditioner condenser and coil, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 2950,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-AC-L",
  "description": "Replace one air conditioner, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1450,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-MINISPLIT-M",
  "description": "Single-zone mini split, material each",
  "type": "Material",
  "unit": "EA",
  "amount": 2250,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-HVAC-MINISPLIT-L",
  "description": "Install one mini split zone, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1150,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DRY-CEILING-L",
  "description": "Hang and finish ceiling drywall, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 2.65,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-PAINT-CABINET-L",
  "description": "Prep, prime and spray cabinetry, labor per linear foot",
  "type": "Labor",
  "unit": "LF",
  "amount": 48,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-FLR-STAIR-L",
  "description": "Install stair treads and risers, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 115,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-WAINSCOT-M",
  "description": "Wainscot or accent wall material, per square foot",
  "type": "Material",
  "unit": "SF",
  "amount": 9.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-TRIM-WAINSCOT-L",
  "description": "Install wainscot or accent wall, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 11,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DEMO-STRUCTURE-L",
  "description": "Demolish and remove a structure, labor per square foot",
  "type": "Labor",
  "unit": "SF",
  "amount": 7.5,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DEMO-KITCHEN-L",
  "description": "Strip out a kitchen to framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1850,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-DEMO-BATH-L",
  "description": "Strip out a bathroom to framing, labor each",
  "type": "Labor",
  "unit": "EA",
  "amount": 1250,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-GC-SUPERVISION-L",
  "description": "Project supervision and coordination, labor per day on site",
  "type": "Labor",
  "unit": "EA",
  "amount": 585,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 },
 {
  "code": "RC-GC-PROTECTION-L",
  "description": "Site protection, temporary barriers and daily tidy, labor per day",
  "type": "Labor",
  "unit": "EA",
  "amount": 225,
  "source": "Boise / Treasure Valley planning averages, reviewed 2026-09-20",
  "basis": "owner-average-cost"
 }
];
