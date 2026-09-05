import {
  Check,
  Clock3,
  Compass,
  MapPinned,
  Plane,
  UserRound,
} from 'lucide-react';
import type { QuestionnaireStatusRow } from '@/lib/preferences/model';
import { getMemberDisplays } from '@/lib/trips/member-display';

export function ReadinessList({
  rows,
}: {
  rows: (QuestionnaireStatusRow & { user_id?: string })[];
}) {
  const displays = getMemberDisplays(
    rows.map((row) => ({
      id: row.member_id,
      userId: row.user_id ?? row.member_id,
      displayName: row.display_name,
    })),
  );
  const markerIcons = [UserRound, Plane, Compass, MapPinned];

  return (
    <ul className="mt-7 grid gap-3 sm:grid-cols-2">
      {rows.map((row) => {
        const display = displays.get(row.member_id);
        const MarkerIcon = markerIcons[display?.marker ?? 0];
        return (
          <li
            key={row.member_id}
            className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-warm-border bg-parchment px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-2 truncate font-medium">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper text-brown-accent">
                <MarkerIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="truncate">
                {display?.name ?? row.display_name}
                {display?.tag && (
                  <span className="ml-1 text-sm font-normal text-warm-muted">
                    · {display.tag}
                  </span>
                )}
              </span>
            </span>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                row.completed
                  ? 'bg-ink text-paper'
                  : 'border border-warm-border bg-paper text-warm-muted'
              }`}
            >
              {row.completed ? (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  Ready
                </>
              ) : (
                <>
                  <Clock3 className="size-4" aria-hidden="true" />
                  Waiting
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
