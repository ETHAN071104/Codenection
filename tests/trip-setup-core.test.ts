import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canControlTripSetup,
  hasConfirmedScope,
  parseTripPlanningMode,
  parseTripSetupStage,
} from '../lib/trips/setup-core';

void test('only the authenticated creator controls shared setup', () => {
  assert.equal(canControlTripSetup('host-user', 'host-user'), true);
  assert.equal(canControlTripSetup('host-user', 'member-user'), false);
  assert.equal(canControlTripSetup('', 'member-user'), false);
});

void test('shared setup values accept only persisted states', () => {
  assert.equal(parseTripPlanningMode('collaborative'), 'collaborative');
  assert.equal(parseTripPlanningMode('ai'), 'ai');
  assert.equal(parseTripPlanningMode('member_override'), null);
  assert.equal(parseTripSetupStage('collaborative_ready'), 'collaborative_ready');
  assert.equal(parseTripSetupStage('unknown'), 'destination');
});

void test('travel range is visible only after host confirmation', () => {
  assert.equal(hasConfirmedScope('scope'), false);
  assert.equal(hasConfirmedScope('mode'), true);
  assert.equal(hasConfirmedScope('preparing'), true);
  assert.equal(hasConfirmedScope('ai_ready'), true);
});
