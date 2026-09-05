'use client';

import { useMemo, useState } from 'react';
import { CloudRain, CloudSun } from 'lucide-react';
import type { ItineraryItemView } from '@/lib/phase2/types';
import type { WeatherAtStop } from '@/lib/planner/types';
import type { TripRoute } from '@/lib/routing/types';

function minutes(time: string) { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; }
function timeLabel(value: number) { return `${String(Math.floor((value % 1440) / 60)).padStart(2, '0')}:00`; }

export function ActivityWeatherTimeline({ items, route, weather, nowMinutes, isToday }: { items: ItineraryItemView[]; route: TripRoute | null; weather: Map<string, WeatherAtStop>; nowMinutes: number; isToday: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const range = useMemo(() => {
    const start = Math.floor((minutes(items[0]?.plannedTime ?? '09:00') - 30) / 60) * 60;
    const last = items[items.length - 1]; const end = Math.ceil((minutes(last?.plannedTime ?? '18:00') + (last?.estimatedDurationMinutes ?? 60) + 30) / 60) * 60;
    return { start, end: Math.max(end, start + 180) };
  }, [items]);
  const width = Math.max(720, (range.end - range.start) * 2.2);
  const left = (value: number) => ((value - range.start) / (range.end - range.start)) * 100;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  return <section className="bg-paper p-4 sm:p-5">
    <div className="flex items-baseline justify-between gap-3"><h2 className="font-editorial text-lg font-semibold">Day overview</h2><p className="text-xs text-warm-muted">Swipe for later hours</p></div>
    <div className="mt-4 overflow-x-auto overscroll-x-contain pb-3" aria-label="Activity and weather timeline">
      <div className="relative min-h-56" style={{ width }}>
        <div className="absolute inset-x-0 top-0 flex justify-between font-mono text-xs text-warm-muted">{Array.from({ length: Math.floor((range.end - range.start) / 120) + 1 }, (_, index) => <span key={index}>{timeLabel(range.start + index * 120)}</span>)}</div>
        <div className="absolute left-0 right-0 top-8 border-t border-warm-border" />
        {items.map((item) => { const point = weather.get(item.id); const Icon = (point?.precipitationProbability ?? 0) >= 50 ? CloudRain : CloudSun; return <button key={`weather-${item.id}`} type="button" onClick={() => setSelectedId(item.id)} className="absolute top-11 -translate-x-1/2 text-center text-xs text-warm-muted" style={{ left: `${left(minutes(item.plannedTime))}%` }}><Icon className="mx-auto size-4 text-brown-accent" /><span className="mt-1 block">{point?.temperatureC === null || !point ? 'Weather' : `${Math.round(point.temperatureC)}°`}</span><span>{point?.precipitationProbability === null || !point ? '' : `${Math.round(point.precipitationProbability)}%`}</span></button>; })}
        <div className="absolute left-0 right-0 top-28 border-t border-warm-border" />
        {items.map((item, index) => { const start = minutes(item.plannedTime); const end = start + item.estimatedDurationMinutes; const segment = index ? route?.segments.find((candidate) => candidate.fromItemId === items[index - 1].id && candidate.toItemId === item.id) : null; return <div key={item.id}>{segment && <span className="absolute top-[7.1rem] -translate-y-full text-[11px] text-warm-muted" style={{ left: `${left(minutes(items[index - 1].plannedTime) + items[index - 1].estimatedDurationMinutes)}%` }}>{Math.round(segment.durationSeconds / 60)} min travel</span>}<button type="button" onClick={() => setSelectedId(item.id)} className="absolute top-[8.7rem] h-16 overflow-hidden rounded-lg border border-warm-border bg-parchment px-2 text-left text-xs text-ink transition-colors hover:bg-[#efe8dd]" style={{ left: `${left(start)}%`, width: `${Math.max(8, left(end) - left(start))}%` }}><span className="block truncate font-semibold">{item.place.name}</span><span className="mt-1 block font-mono">{item.plannedTime}</span></button></div>; })}
        {isToday && nowMinutes >= range.start && nowMinutes <= range.end && <div className="absolute bottom-0 top-6 border-l-2 border-brown-accent" style={{ left: `${left(nowMinutes)}%` }}><span className="-ml-4 -mt-5 block text-[10px] font-bold text-brown-accent">NOW</span></div>}
      </div>
    </div>
    {selected && <p className="border-t border-warm-border pt-3 text-sm text-warm-muted"><span className="font-semibold text-ink">{selected.place.name}</span> at {selected.plannedTime}. {weather.get(selected.id)?.condition ?? 'Weather unavailable'}</p>}
  </section>;
}
