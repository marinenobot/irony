import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCastle, calculateDeparture, calculateLanding, calculateSwitchImpact} from '../js/domain/timing.js';
import {lookupMarchTime} from '../js/domain/march.js';

test('castle rallies with different march times arrive together across UTC midnight', () => {
  const nowMs = Date.parse('2026-10-22T23:59:30Z');
  const timing = calculateCastle({nowMs, prepSeconds:30, rallyMinutes:5, maxMarchSeconds:62});
  assert.equal(new Date(timing.impactTime).toISOString(), '2026-10-23T00:06:02.000Z');
  for(const march of [10, 40, 62]){
    const departure = calculateDeparture(timing.firstDepartureTime, 62, march);
    assert.equal(departure + 5 * 60_000 + march * 1000, timing.impactTime);
  }
});

test('landing and switch calculations keep their different rally semantics', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(calculateLanding(now, 30, 1), Date.parse('2026-10-22T12:01:30Z'));
  assert.equal(calculateLanding(now, 0, 5), Date.parse('2026-10-22T12:05:00Z'));
  const impact = calculateSwitchImpact(now, 30, 55);
  assert.equal(impact, Date.parse('2026-10-22T12:01:25Z'));
  assert.equal(impact - 55_000, now + 30_000);
});

test('measured march lookup selects all four boost/pet combinations', () => {
  assert.equal(lookupMarchTime(592, 590, false, false), 62);
  assert.equal(lookupMarchTime(592, 590, true, false), 55);
  assert.equal(lookupMarchTime(592, 590, false, true), 50);
  assert.equal(lookupMarchTime(592, 590, true, true), 45);
  assert.equal(lookupMarchTime(1, 1, false, false), null);
});
