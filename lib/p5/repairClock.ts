export interface PricingRepairClock {startedAt:number;busyWaitMs:number}
export interface PricingRepairState {repairClock?:PricingRepairClock}

/** Start once, when repair is actually needed. Saved stage replays retain the
 * same clock, so initial analysis cannot consume it and a retry cannot renew it. */
export async function beginPricingRepair(state:PricingRepairState,persist:()=>Promise<void>,busyWaitMs=0,now=Date.now()):Promise<PricingRepairClock>{
  if(!state.repairClock){
    state.repairClock={startedAt:now,busyWaitMs:Math.max(0,busyWaitMs||0)};
    await persist();
  }
  return state.repairClock;
}
