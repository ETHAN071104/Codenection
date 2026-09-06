'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type PresencePayload = {
  userId: string;
  displayName: string;
  editingItemId: string | null;
};

export type TripRealtimeStatus =
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

export function useTripRealtime({
  tripId,
  editingItemId,
  onItineraryChange,
  onStatusChange,
}: {
  tripId: string;
  editingItemId: string | null;
  onItineraryChange: () => void;
  onStatusChange?: (status: TripRealtimeStatus) => void;
}) {
  const [others, setOthers] = useState<PresencePayload[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const ownPresenceRef = useRef<PresencePayload | null>(null);
  const changeHandlerRef = useRef(onItineraryChange);
  const statusHandlerRef = useRef(onStatusChange);

  useEffect(() => {
    changeHandlerRef.current = onItineraryChange;
  }, [onItineraryChange]);

  useEffect(() => {
    statusHandlerRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const supabase = getSupabaseBrowserClient();

    async function connect() {
      statusHandlerRef.current?.('CONNECTING');
      try {
        const user = await ensureAnonymousUser();
        const { data: membership } = await supabase
          .from('trip_members')
          .select('display_name')
          .eq('trip_id', tripId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled || !membership) return;

        const ownPresence: PresencePayload = {
          userId: user.id,
          displayName: membership.display_name,
          editingItemId: null,
        };
        ownPresenceRef.current = ownPresence;

        function scheduleRefresh() {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => changeHandlerRef.current(), 350);
        }

        const channel = supabase
          .channel(`trip-planner:${tripId}`, {
            config: { presence: { key: user.id } },
          })
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'itinerary_items',
              filter: `trip_id=eq.${tripId}`,
            },
            scheduleRefresh,
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'places',
              filter: `trip_id=eq.${tripId}`,
            },
            scheduleRefresh,
          )
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState<PresencePayload>();
            const nextOthers = Object.values(state)
              .flat()
              .flatMap((entry) =>
                typeof entry?.userId === 'string' &&
                entry.userId !== user.id &&
                typeof entry.displayName === 'string'
                  ? [
                      {
                        userId: entry.userId,
                        displayName: entry.displayName,
                        editingItemId:
                          typeof entry.editingItemId === 'string'
                            ? entry.editingItemId
                            : null,
                      },
                    ]
                  : [],
              );
            setOthers(nextOthers);
          })
          .subscribe(async (status) => {
            statusHandlerRef.current?.(status);
            if (status === 'SUBSCRIBED') await channel.track(ownPresence);
          });

        channelRef.current = channel;
      } catch {
        if (!cancelled) statusHandlerRef.current?.('CHANNEL_ERROR');
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      const channel = channelRef.current;
      channelRef.current = null;
      ownPresenceRef.current = null;
      setOthers([]);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tripId]);

  useEffect(() => {
    const channel = channelRef.current;
    const ownPresence = ownPresenceRef.current;
    if (!channel || !ownPresence) return;
    ownPresence.editingItemId = editingItemId;
    void channel.track({ ...ownPresence });
  }, [editingItemId]);

  return others;
}
