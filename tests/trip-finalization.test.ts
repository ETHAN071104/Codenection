import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApplyTripMutation,
  canFinalizeTrip,
  deriveTripLifecycleAccess,
} from '../lib/trips/finalization-core';

const finalizedAt = '2026-09-06T12:00:00.000Z';

void test('only the host with a persisted itinerary can finalize', () => {
  const host = deriveTripLifecycleAccess({
    userId: 'host',
    createdBy: 'host',
    joinedAt: '2026-09-06T10:00:00.000Z',
    finalizedAt: null,
  });
  assert.equal(canFinalizeTrip(host, true), true);
  assert.equal(canFinalizeTrip(host, false), false);
  assert.equal(canFinalizeTrip({ ...host, isHost: false }, true), false);
});

void test('finalization is a stable lifecycle state', () => {
  const first = deriveTripLifecycleAccess({
    userId: 'host',
    createdBy: 'host',
    joinedAt: '2026-09-06T10:00:00.000Z',
    finalizedAt,
  });
  const second = deriveTripLifecycleAccess({
    userId: 'host',
    createdBy: 'host',
    joinedAt: '2026-09-06T10:00:00.000Z',
    finalizedAt,
  });
  assert.deepEqual(second, first);
  assert.equal(first.isFinalized, true);
});

void test('late joiners receive trip access but never planning access', () => {
  const lateJoiner = deriveTripLifecycleAccess({
    userId: 'late',
    createdBy: 'host',
    joinedAt: '2026-09-06T12:05:00.000Z',
    finalizedAt,
  });
  assert.equal(lateJoiner.isLateJoiner, true);
  assert.equal(canApplyTripMutation(lateJoiner, 'planning'), false);
  assert.equal(canApplyTripMutation(lateJoiner, 'live_change'), true);
});

void test('original planning members cannot reopen planning after finalization', () => {
  const originalMember = deriveTripLifecycleAccess({
    userId: 'member',
    createdBy: 'host',
    joinedAt: '2026-09-06T10:30:00.000Z',
    finalizedAt,
  });
  assert.equal(originalMember.isLateJoiner, false);
  assert.equal(canApplyTripMutation(originalMember, 'planning'), false);
});

void test('AI Edit and Live Change remain allowed after finalization', () => {
  const member = deriveTripLifecycleAccess({
    userId: 'member',
    createdBy: 'host',
    joinedAt: '2026-09-06T10:30:00.000Z',
    finalizedAt,
  });
  assert.equal(canApplyTripMutation(member, 'planning'), false);
  assert.equal(canApplyTripMutation(member, 'ai_edit'), true);
  assert.equal(canApplyTripMutation(member, 'live_change'), true);
});

void test('Emergency and Change Bar mutations remain available to late joiners', () => {
  const lateJoiner = deriveTripLifecycleAccess({
    userId: 'late',
    createdBy: 'host',
    joinedAt: '2026-09-06T12:05:00.000Z',
    finalizedAt,
  });
  assert.equal(canApplyTripMutation(lateJoiner, 'live_change'), true);
});
