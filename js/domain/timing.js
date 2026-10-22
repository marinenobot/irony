// All times are Unix milliseconds; durations are seconds unless named minutes.
// These functions have no DOM, storage, network or clock side effects.
export function pad2(value){ return String(value).padStart(2, '0'); }

export function calculateCastle({nowMs, prepSeconds, rallyMinutes, maxMarchSeconds}){
  return {
    firstDepartureTime:nowMs + prepSeconds * 1000,
    impactTime:nowMs + prepSeconds * 1000 + rallyMinutes * 60 * 1000 + maxMarchSeconds * 1000
  };
}

export function calculateDeparture(firstDepartureTime, maxMarchSeconds, marchSeconds){
  return firstDepartureTime + (maxMarchSeconds - marchSeconds) * 1000;
}

export function calculateLanding(nowMs, prepSeconds, rallyMinutes){
  return nowMs + (prepSeconds + rallyMinutes * 60) * 1000;
}

export function calculateSwitchImpact(nowMs, fromNowSeconds, baseMarchSeconds){
  return nowMs + fromNowSeconds * 1000 + baseMarchSeconds * 1000;
}
