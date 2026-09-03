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
    <ul className="mt-8 grid gap-px overflow-hidden border border-[#35383d]/30 bg-[#35383d]/30 sm:grid-cols-2">
      {rows.map((row) => {
        const display = displays.get(row.member_id);
        const MarkerIcon = markerIcons[display?.marker ?? 0];
        return (
          <li
            key={row.member_id}
            className="flex items-center justify-between gap-4 bg-[#f2eee1] px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-2 truncate font-medium">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2f3237]/10 text-[#2f3237]">
                <MarkerIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="truncate">
                {display?.name ?? row.display_name}
                {display?.tag && (
                  <span className="ml-1 text-sm font-normal text-[#5a5d61]">
                    · {display.tag}
                  </span>
                )}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-sm text-[#5a5d61]">
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
