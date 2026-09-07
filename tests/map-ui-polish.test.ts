import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasUsablePlacePhoto,
  parsePlacePhotoAttributions,
} from '../lib/malaysia-places/photo-core';
import {
  nextAiPanelState,
  routeColorForDay,
  visibleRouteDayNumbers,
} from '../lib/planner/map-view-core';

void test('place photo metadata falls back safely when unavailable', () => {
  assert.equal(hasUsablePlacePhoto({ photoName: null }), false);
  assert.equal(hasUsablePlacePhoto({ photoName: '' }), false);
  assert.equal(
    hasUsablePlacePhoto({ photoName: 'places/example/photos/photo-id' }),
    true,
  );
  assert.deepEqual(
    parsePlacePhotoAttributions([
      { displayName: 'Google contributor', uri: 'https://example.com/profile' },
    ]),
    [
      {
        displayName: 'Google contributor',
        uri: 'https://example.com/profile',
        photoUri: null,
      },
    ],
  );
});

void test('Ask AI starts collapsed, toggles for a day, and stays closed in All', () => {
  const initial = false;
  assert.equal(nextAiPanelState(initial, 1), true);
  assert.equal(nextAiPanelState(true, 1), false);
  assert.equal(nextAiPanelState(true, 'all'), false);
});

void test('All exposes every day route with stable distinct day colors', () => {
  assert.deepEqual(visibleRouteDayNumbers([1, 2, 3], 'all'), [1, 2, 3]);
  assert.deepEqual(visibleRouteDayNumbers([1, 2, 3], 2), [2]);
  assert.notEqual(routeColorForDay(1), routeColorForDay(2));
  assert.equal(routeColorForDay(1), routeColorForDay(1));
  assert.equal(
    new Set(Array.from({ length: 30 }, (_, index) => routeColorForDay(index + 1)))
      .size,
    30,
  );
});
