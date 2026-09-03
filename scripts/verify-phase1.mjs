import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey)
  throw new Error('Supabase environment is missing.');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function isolatedClient() {
  return createClient(url, publishableKey, {
    auth: {
      storage: memoryStorage(),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
}

function includesToken(error, token) {
  return Boolean(error && String(error.message).includes(token));
}

async function anonymousIdentity(client, name) {
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error(`${name} auth failed.`);
  assert(data.user.is_anonymous === true, `${name} should be anonymous`);
  return data.user.id;
}

async function statusFor(client, tripId) {
  const { data, error } = await client.rpc('get_questionnaire_status', {
    p_trip_id: tripId,
  });
  if (error) throw error;
  return data ?? [];
}

async function save(client, tripId, values) {
  const { data, error } = await client.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: values.budget,
    p_budget_unlimited: values.unlimited,
    p_travel_pace: values.pace,
    p_interests: values.interests,
  });
  if (error) throw error;
  assert(
    Boolean(data?.[0]?.completed_at),
    'submission should return completed_at',
  );
  return data[0].completed_at;
}

const ethan = isolatedClient();
const alex = isolatedClient();
const ben = isolatedClient();
const mallory = isolatedClient();
const unauthenticated = isolatedClient();

let tripId;
let customTripId;
let roomCode;
const results = {};

try {
  const [ethanId, alexId, benId, malloryId] = await Promise.all([
    anonymousIdentity(ethan, 'Ethan'),
    anonymousIdentity(alex, 'Alex'),
    anonymousIdentity(ben, 'Ben'),
    anonymousIdentity(mallory, 'Mallory'),
  ]);

  assert(
    new Set([ethanId, alexId, benId, malloryId]).size === 4,
    'identities must be isolated',
  );

  const createResult = await ethan.rpc('create_trip', {
    p_display_name: 'Ethan',
    p_duration_days: 3,
  });
  if (createResult.error) throw createResult.error;
  tripId = createResult.data?.[0]?.trip_id;
  roomCode = createResult.data?.[0]?.room_code;
  assert(Boolean(tripId), 'trip should be created');
  assert(/^\d{6}$/.test(roomCode ?? ''), 'room code should be six digits');

  const tripDuration = await ethan
    .from('trips')
    .select('duration_days, destination, start_date, end_date')
    .eq('id', tripId)
    .maybeSingle();
  if (tripDuration.error) throw tripDuration.error;
  assert(
    tripDuration.data?.duration_days === 3,
    'preset duration should persist as 3 days',
  );
  assert(
    tripDuration.data?.destination === null &&
      tripDuration.data?.start_date === null &&
      tripDuration.data?.end_date === null,
    'destination and dates should remain optional',
  );
  results.tripLength = '3D2N';
  results.optionalTripFields = true;

  const customCreateResult = await ethan.rpc('create_trip', {
    p_display_name: 'Ethan',
    p_duration_days: 7,
  });
  if (customCreateResult.error) throw customCreateResult.error;
  customTripId = customCreateResult.data?.[0]?.trip_id;
  assert(Boolean(customTripId), 'custom-duration trip should be created');

  const customTripDuration = await ethan
    .from('trips')
    .select('duration_days')
    .eq('id', customTripId)
    .maybeSingle();
  if (customTripDuration.error) throw customTripDuration.error;
  assert(
    customTripDuration.data?.duration_days === 7,
    'custom duration should persist as 7 days',
  );
  results.customTripLength = '7D6N';

  for (const { client, displayName } of [
    { client: alex, displayName: 'Alex' },
    { client: ben, displayName: 'Ben' },
  ]) {
    const joined = await client.rpc('join_trip_by_code', {
      p_room_code: roomCode,
      p_display_name: displayName,
    });
    if (joined.error) throw joined.error;
    assert(
      joined.data?.[0]?.trip_id === tripId,
      `${displayName} should share the trip`,
    );
  }

  const initialStatus = await statusFor(ethan, tripId);
  assert(initialStatus.length === 3, 'status should include three members');
  assert(initialStatus[0].total_members === 3, 'total should be three');
  assert(
    initialStatus[0].completed_members === 0,
    'initial completion should be zero',
  );
  assert(
    initialStatus.every((row) => !row.completed),
    'every member should initially wait',
  );
  assert(
    Object.keys(initialStatus[0]).sort().join(',') ===
      'all_completed,completed,completed_members,display_name,member_id,total_members',
    'status RPC should expose only safe fields',
  );
  results.initialStatus = '0 / 3';

  const ethanValues = {
    budget: 500,
    unlimited: false,
    pace: 4,
    interests: {
      food_dining: 5,
      history_heritage: 4,
      nature_viewpoints: 3,
      instagrammable_cafes: 2,
    },
  };
  const ethanCompletedAt = await save(ethan, tripId, ethanValues);

  const afterEthan = await statusFor(alex, tripId);
  assert(
    afterEthan[0].completed_members === 1,
    'Ethan should make status 1 / 3',
  );
  assert(!afterEthan[0].all_completed, 'summary should remain locked at 1 / 3');
  results.afterEthan = '1 / 3';

  const alexReadsEthan = await alex
    .from('preference_profiles')
    .select('personal_budget, travel_pace, interests')
    .eq('trip_id', tripId)
    .eq('user_id', ethanId);
  if (alexReadsEthan.error) throw alexReadsEthan.error;
  assert(
    alexReadsEthan.data.length === 0,
    'Alex must not read Ethan raw values',
  );

  const benReadsEthan = await ben
    .from('preference_profiles')
    .select('personal_budget, travel_pace, interests')
    .eq('trip_id', tripId)
    .eq('user_id', ethanId);
  if (benReadsEthan.error) throw benReadsEthan.error;
  assert(benReadsEthan.data.length === 0, 'Ben must not read Ethan raw values');
  results.peerPrivacyBeforeCompletion = true;

  const ethanOwn = await ethan
    .from('preference_profiles')
    .select(
      'personal_budget, budget_unlimited, travel_pace, interests, completed_at',
    )
    .eq('trip_id', tripId)
    .maybeSingle();
  if (ethanOwn.error) throw ethanOwn.error;
  assert(
    Number(ethanOwn.data?.personal_budget) === 500,
    'Ethan budget should persist',
  );
  assert(
    ethanOwn.data?.budget_unlimited === false,
    'Ethan budget should be finite',
  );
  assert(ethanOwn.data?.travel_pace === 4, 'Ethan pace should persist');
  assert(
    ethanOwn.data?.completed_at === ethanCompletedAt,
    'Ethan completion time should persist',
  );
  results.ownPersistence = true;

  await save(alex, tripId, {
    budget: null,
    unlimited: true,
    pace: 3,
    interests: {
      food_dining: 4,
      history_heritage: 3,
      nature_viewpoints: 5,
      instagrammable_cafes: 3,
    },
  });

  const afterAlex = await statusFor(ben, tripId);
  assert(afterAlex[0].completed_members === 2, 'Alex should make status 2 / 3');
  assert(!afterAlex[0].all_completed, 'summary should remain locked at 2 / 3');
  results.afterAlex = '2 / 3';

  const lockedSummary = await ethan.rpc('get_group_preference_summary', {
    p_trip_id: tripId,
  });
  assert(
    includesToken(lockedSummary.error, 'QUESTIONNAIRE_NOT_READY'),
    'summary RPC should return QUESTIONNAIRE_NOT_READY before completion',
  );
  results.summaryLocked = true;

  await save(ben, tripId, {
    budget: 300,
    unlimited: false,
    pace: 2,
    interests: {
      food_dining: 5,
      history_heritage: 5,
      nature_viewpoints: 4,
      instagrammable_cafes: 1,
    },
  });

  const finalStatus = await statusFor(ethan, tripId);
  assert(
    finalStatus[0].completed_members === 3,
    'Ben should make status 3 / 3',
  );
  assert(finalStatus[0].all_completed, 'all members should be complete');
  results.finalStatus = '3 / 3';

  const summaryResult = await alex.rpc('get_group_preference_summary', {
    p_trip_id: tripId,
  });
  if (summaryResult.error) throw summaryResult.error;
  const summary = summaryResult.data?.[0];
  assert(Boolean(summary), 'summary should be returned');
  assert(
    Object.keys(summary).sort().join(',') ===
      'average_interests,average_pace,finite_budget_average,unlimited_members',
    'summary RPC should expose only aggregate fields',
  );
  assert(
    Number(summary.finite_budget_average) === 400,
    'finite budget average should be 400',
  );
  assert(
    Number(summary.unlimited_members) === 1,
    'one traveller should be unlimited',
  );
  assert(Number(summary.average_pace) === 3, 'average pace should be 3');
  assert(
    Number(summary.average_interests.food_dining) === 4.67,
    'food average should be 4.67',
  );
  assert(
    Number(summary.average_interests.history_heritage) === 4,
    'heritage average should be 4',
  );
  assert(
    Number(summary.average_interests.nature_viewpoints) === 4,
    'nature average should be 4',
  );
  assert(
    Number(summary.average_interests.instagrammable_cafes) === 2,
    'cafe average should be 2',
  );
  results.summary = {
    finiteBudgetAverage: Number(summary.finite_budget_average),
    unlimitedMembers: Number(summary.unlimited_members),
    averagePace: Number(summary.average_pace),
    interests: summary.average_interests,
  };

  const alexReadsAfterCompletion = await alex
    .from('preference_profiles')
    .select('personal_budget, travel_pace, interests')
    .eq('trip_id', tripId)
    .eq('user_id', ethanId);
  if (alexReadsAfterCompletion.error) throw alexReadsAfterCompletion.error;
  const ethanReadsAlex = await ethan
    .from('preference_profiles')
    .select('personal_budget, travel_pace, interests')
    .eq('trip_id', tripId)
    .eq('user_id', alexId);
  if (ethanReadsAlex.error) throw ethanReadsAlex.error;
  assert(
    alexReadsAfterCompletion.data.length === 0,
    'Alex still must not read Ethan',
  );
  assert(ethanReadsAlex.data.length === 0, 'Ethan still must not read Alex');
  results.peerPrivacyAfterCompletion = true;

  const updatedAt = await save(ethan, tripId, ethanValues);
  const ethanProfileCount = await ethan
    .from('preference_profiles')
    .select('id', { count: 'exact' })
    .eq('trip_id', tripId);
  if (ethanProfileCount.error) throw ethanProfileCount.error;
  assert(
    ethanProfileCount.count === 1,
    'editing must not create a duplicate profile',
  );
  assert(
    updatedAt >= ethanCompletedAt,
    'editing should refresh completion time',
  );
  results.editWithoutDuplicate = true;

  const invalidBudget = await ethan.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 1000001,
    p_budget_unlimited: false,
    p_travel_pace: 4,
    p_interests: ethanValues.interests,
  });
  assert(
    includesToken(invalidBudget.error, 'INVALID_BUDGET'),
    'oversized budget should fail',
  );

  const stringRatings = await ethan.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 500,
    p_budget_unlimited: false,
    p_travel_pace: 4,
    p_interests: {
      food_dining: '5',
      history_heritage: '4',
      nature_viewpoints: '3',
      instagrammable_cafes: '2',
    },
  });
  assert(Boolean(stringRatings.error), 'string interest ratings should fail');
  results.serverValidation = true;

  const directInsert = await ethan.from('preference_profiles').insert({
    trip_id: tripId,
    user_id: ethanId,
    personal_budget: 1,
    budget_unlimited: false,
    travel_pace: 1,
    interests: ethanValues.interests,
    completed_at: new Date().toISOString(),
  });
  assert(
    Boolean(directInsert.error),
    'direct profile insert should lack privilege',
  );
  results.directWriteBlocked = directInsert.error.code;

  const malloryStatus = await mallory.rpc('get_questionnaire_status', {
    p_trip_id: tripId,
  });
  const mallorySave = await mallory.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 400,
    p_budget_unlimited: false,
    p_travel_pace: 3,
    p_interests: ethanValues.interests,
  });
  const mallorySummary = await mallory.rpc('get_group_preference_summary', {
    p_trip_id: tripId,
  });
  const malloryRead = await mallory
    .from('preference_profiles')
    .select('*')
    .eq('trip_id', tripId);
  assert(
    includesToken(malloryStatus.error, 'NOT_TRIP_MEMBER'),
    'Mallory status should fail',
  );
  assert(
    includesToken(mallorySave.error, 'NOT_TRIP_MEMBER'),
    'Mallory save should fail',
  );
  assert(
    includesToken(mallorySummary.error, 'NOT_TRIP_MEMBER'),
    'Mallory summary should fail',
  );
  if (malloryRead.error) throw malloryRead.error;
  assert(
    malloryRead.data.length === 0,
    'Mallory raw read should return no rows',
  );
  results.nonMemberProtection = true;

  const unauthStatus = await unauthenticated.rpc('get_questionnaire_status', {
    p_trip_id: tripId,
  });
  const unauthSave = await unauthenticated.rpc('save_preference_profile', {
    p_trip_id: tripId,
    p_personal_budget: 400,
    p_budget_unlimited: false,
    p_travel_pace: 3,
    p_interests: ethanValues.interests,
  });
  assert(Boolean(unauthStatus.error), 'unauthenticated status should fail');
  assert(Boolean(unauthSave.error), 'unauthenticated save should fail');
  results.unauthenticatedBlocked = true;

  results.identities = {
    ethan: `${ethanId.slice(0, 4)}...${ethanId.slice(-4)}`,
    alex: `${alexId.slice(0, 4)}...${alexId.slice(-4)}`,
    ben: `${benId.slice(0, 4)}...${benId.slice(-4)}`,
    mallory: `${malloryId.slice(0, 4)}...${malloryId.slice(-4)}`,
  };
  results.trip = `${tripId.slice(0, 4)}...${tripId.slice(-4)}`;
  results.roomCode = roomCode;
  results.liveVerified = true;
} finally {
  if (customTripId) {
    const customCleanup = await ethan
      .from('trips')
      .delete()
      .eq('id', customTripId)
      .select('id');
    results.customTestTripDeleted =
      !customCleanup.error && customCleanup.data?.[0]?.id === customTripId;
  }
  if (tripId) {
    const cleanup = await ethan
      .from('trips')
      .delete()
      .eq('id', tripId)
      .select('id');
    results.testTripDeleted =
      !cleanup.error && cleanup.data?.[0]?.id === tripId;
  }
  console.log(JSON.stringify(results, null, 2));
}
