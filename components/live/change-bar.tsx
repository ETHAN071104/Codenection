'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Clock3,
  CloudRain,
  PackageSearch,
  Timer,
  UsersRound,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ItineraryItemView } from '@/lib/phase2/types';
import type { WeatherAtStop } from '@/lib/planner/types';
import type {
  LiveTripMember,
  TripChangeEvent,
  TripChangeType,
} from '@/lib/live/trip-change';

type ChangeOption = {
  type: TripChangeType;
  label: string;
  Icon: typeof Clock3;
};

const CHANGE_OPTIONS: ChangeOption[] = [
  { type: 'stay_longer', label: 'Stay longer', Icon: Clock3 },
  { type: 'running_late', label: 'Running late', Icon: Timer },
  { type: 'lost_item', label: 'Lost item', Icon: PackageSearch },
  { type: 'separated', label: 'Someone separated', Icon: UsersRound },
  { type: 'weather_problem', label: 'Weather problem', Icon: CloudRain },
  { type: 'emergency', label: 'Emergency', Icon: AlertTriangle },
];

const MINUTE_CHOICES = [15, 30, 60];
const WEATHER_DELAY_CHOICES = [30, 60, 90];

export type WeatherDisruption = {
  item: ItineraryItemView;
  weather: WeatherAtStop;
};

function eventSummary(event: TripChangeEvent, members: LiveTripMember[]) {
  if (event.type === 'stay_longer') {
    return `Stay ${event.minutes} minutes longer`;
  }
  if (event.type === 'running_late') {
    return `Running ${event.minutes} minutes late`;
  }
  if (event.type === 'lost_item') return 'Lost item noted';
  if (event.type === 'separated') {
    const member = members.find((candidate) => candidate.id === event.memberId);
    return member ? `${member.displayName} is separated` : 'Someone separated';
  }
  if (event.type === 'weather_problem') return 'Weather problem noted';
  return 'Emergency noted';
}

export function ChangeBar({
  members,
  weatherContext,
  weatherDisruptions,
  weatherAvailable,
  schedule,
  onScheduleApply,
  onWeatherDelay,
  onWeatherSkip,
}: {
  members: LiveTripMember[];
  weatherContext: string | null;
  weatherDisruptions: WeatherDisruption[];
  weatherAvailable: boolean;
  schedule: { day: number; current: ItineraryItemView; later: ItineraryItemView[] } | null;
  onScheduleApply: (event: Extract<TripChangeEvent, { type: 'stay_longer' | 'running_late' }>) => Promise<void>;
  onWeatherDelay: (item: ItineraryItemView, minutes: number) => Promise<void>;
  onWeatherSkip: (item: ItineraryItemView) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<TripChangeType | null>(null);
  const [note, setNote] = useState('');
  const [capturedEvent, setCapturedEvent] = useState<TripChangeEvent | null>(
    null,
  );
  const [scheduleEvent, setScheduleEvent] = useState<Extract<TripChangeEvent, { type: 'stay_longer' | 'running_late' }> | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [weatherAction, setWeatherAction] = useState<'delay' | 'skip' | null>(null);
  const [weatherDelay, setWeatherDelay] = useState<number | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function selectType(type: TripChangeType) {
    setActiveType(type);
    setNote('');
    setCapturedEvent(null);
    setScheduleEvent(null);
    setApplyError(null);
    setWeatherAction(null);
    setWeatherDelay(null);
  }

  function capture(event: TripChangeEvent) {
    setCapturedEvent(event);
  }

  function close() {
    setOpen(false);
    setActiveType(null);
    setNote('');
    setCapturedEvent(null);
    setScheduleEvent(null);
    setApplyError(null);
    setWeatherAction(null);
    setWeatherDelay(null);
  }

  const option = CHANGE_OPTIONS.find((candidate) => candidate.type === activeType);

  async function applySchedule() {
    if (!scheduleEvent || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onScheduleApply(scheduleEvent);
      setCapturedEvent(scheduleEvent);
      setScheduleEvent(null);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'We could not update the schedule.');
    } finally {
      setApplying(false);
    }
  }

  const weatherDisruption = weatherDisruptions[0] ?? null;
  const weatherSchedule = weatherDisruption && schedule
    ? {
        day: schedule.day,
        current: weatherDisruption.item,
        later: schedule.later.filter(
          (item) => item.sortOrder > weatherDisruption.item.sortOrder,
        ),
      }
    : null;

  async function applyWeatherDelay() {
    if (!weatherDelay || !weatherSchedule || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onWeatherDelay(weatherSchedule.current, weatherDelay);
      close();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'We could not update the schedule.');
    } finally {
      setApplying(false);
    }
  }

  async function applyWeatherSkip() {
    if (!weatherDisruption || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onWeatherSkip(weatherDisruption.item);
      close();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'We could not remove this stop.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 border border-[#35383d] bg-[#2f3237] px-4 text-sm font-semibold text-[#f8f4e8] transition-colors hover:bg-[#1f2227] active:translate-y-px sm:w-auto"
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
        Something changed
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end bg-[#1f2227]/35 sm:items-center sm:justify-center">
          <button
            type="button"
            aria-label="Close change panel"
            className="absolute inset-0 cursor-default"
            onClick={close}
          />
          <dialog
            open
            aria-labelledby="change-bar-title"
            className="relative z-10 max-h-[82dvh] w-full overflow-y-auto border border-[#35383d]/35 bg-[#fffdf8] shadow-[0_-24px_65px_rgba(67,58,44,0.3)] sm:max-w-lg sm:shadow-[0_24px_65px_rgba(67,58,44,0.3)]"
          >
            <div className="flex items-start justify-between border-b border-[#35383d]/20 bg-[#f2eee1] p-5">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-[#5a5d61]">
                  LIVE CHANGE
                </p>
                <h2
                  id="change-bar-title"
                  className="mt-1 text-xl font-semibold tracking-[-0.03em]"
                >
                  {option ? option.label : 'What happened?'}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close change panel"
                className="-mr-2 -mt-2 flex size-10 items-center justify-center text-[#35383d] hover:bg-[#e7e0cd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237]/30"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 sm:p-6">
              {!activeType ? (
                <div className="grid grid-cols-2 gap-2">
                  {CHANGE_OPTIONS.map(({ type, label, Icon }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => selectType(type)}
                      className="flex min-h-24 flex-col items-start justify-between border border-[#8b8170]/35 bg-[#fffdf8] p-4 text-left text-[#35383d] transition-colors hover:bg-[#f2eee1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3237]/30 active:translate-y-px"
                    >
                      <Icon className="size-5" aria-hidden="true" />
                      <span className="text-sm font-semibold leading-5">{label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveType(null);
                      setCapturedEvent(null);
                    }}
                    className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-[#35383d] underline-offset-4 hover:underline"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    All changes
                  </button>

                  {activeType === 'stay_longer' && (
                    scheduleEvent?.type === 'stay_longer' && schedule ? <SchedulePreview event={scheduleEvent} schedule={schedule} applying={applying} error={applyError} onApply={() => void applySchedule()} onCancel={() => setScheduleEvent(null)} /> : <ChoiceCapture
                      prompt="How much longer?"
                      choices={MINUTE_CHOICES}
                      suffix="min"
                      onChoose={(minutes) =>
                        setScheduleEvent({ type: 'stay_longer', minutes })
                      }
                    />
                  )}

                  {activeType === 'running_late' && (
                    scheduleEvent?.type === 'running_late' && schedule ? <SchedulePreview event={scheduleEvent} schedule={schedule} applying={applying} error={applyError} onApply={() => void applySchedule()} onCancel={() => setScheduleEvent(null)} /> : <ChoiceCapture
                      prompt="How late are you?"
                      choices={MINUTE_CHOICES}
                      suffix="min"
                      onChoose={(minutes) =>
                        setScheduleEvent({ type: 'running_late', minutes })
                      }
                    />
                  )}

                  {activeType === 'lost_item' && (
                    <NoteCapture
                      prompt="What happened?"
                      placeholder="Forgot my bag at the previous cafe"
                      note={note}
                      onChange={setNote}
                      onSave={() => capture({ type: 'lost_item', note: note.trim() })}
                      disabled={note.trim().length === 0}
                    />
                  )}

                  {activeType === 'separated' && (
                    <div>
                      <p className="text-sm font-semibold">Who got separated?</p>
                      {members.length > 0 ? (
                        <div className="mt-4 grid gap-2">
                          {members.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() =>
                                capture({ type: 'separated', memberId: member.id })
                              }
                              className="border border-[#8b8170]/35 bg-[#fffdf8] px-4 py-3 text-left font-semibold text-[#35383d] hover:bg-[#f2eee1] active:translate-y-px"
                            >
                              {member.displayName}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4">
                          <p className="text-sm leading-6 text-[#5a5d61]">
                            Record the separation now. Member selection is unavailable.
                          </p>
                          <ActionButton
                            className="mt-4"
                            onClick={() => capture({ type: 'separated' })}
                          >
                            Record separation
                          </ActionButton>
                        </div>
                      )}
                    </div>
                  )}

                  {activeType === 'weather_problem' && (
                    !weatherAvailable ? <div><p className="text-sm font-semibold">Weather data is unavailable right now.</p><p className="mt-2 text-sm leading-6 text-[#5a5d61]">Your Live Trip remains available. Please check again shortly.</p><ActionButton className="mt-4" onClick={close}>Keep plan</ActionButton></div> : !weatherDisruption ? <div><p className="text-sm font-semibold">No significant weather disruption is currently detected for your upcoming stops.</p>{weatherContext && <p className="mt-2 text-sm leading-6 text-[#5a5d61]">Upcoming: {weatherContext}</p>}<ActionButton className="mt-4" onClick={close}>Keep plan</ActionButton></div> : weatherAction === 'delay' && weatherDelay && weatherSchedule ? <SchedulePreview event={{ type: 'running_late', minutes: weatherDelay }} schedule={weatherSchedule} applying={applying} error={applyError} onApply={() => void applyWeatherDelay()} onCancel={() => { setWeatherDelay(null); setWeatherAction(null); }} /> : weatherAction === 'skip' ? <SkipWeatherPreview item={weatherDisruption.item} applying={applying} error={applyError} onApply={() => void applyWeatherSkip()} onCancel={() => setWeatherAction(null)} /> : <WeatherDisruptionChoice disruption={weatherDisruption} laterCount={weatherDisruptions.length - 1} onDelay={(minutes) => { setWeatherAction('delay'); setWeatherDelay(minutes); }} onSkip={() => setWeatherAction('skip')} onKeepPlan={close} />
                  )}

                  {activeType === 'emergency' && (
                    <NoteCapture
                      prompt="Emergency"
                      description="Record a short description if it is safe to do so."
                      placeholder="Briefly describe the situation"
                      note={note}
                      onChange={setNote}
                      onSave={() =>
                        capture({
                          type: 'emergency',
                          ...(note.trim() ? { note: note.trim() } : {}),
                        })
                      }
                    />
                  )}

                  {capturedEvent && (
                    <div className="mt-5 border-l-2 border-[#2f3237] bg-[#f2eee1] p-4">
                      <p className="font-semibold">
                        {eventSummary(capturedEvent, members)}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[#5a5d61]">
                        Schedule adjustment will be handled next.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}

function WeatherDisruptionChoice({ disruption, laterCount, onDelay, onSkip, onKeepPlan }: { disruption: WeatherDisruption; laterCount: number; onDelay: (minutes: number) => void; onSkip: () => void; onKeepPlan: () => void }) {
  const { item, weather } = disruption;
  return <div><p className="text-xs font-semibold tracking-[0.12em] text-[#5a5d61]">WEATHER CHANGE AHEAD</p><div className="mt-3 border-l-2 border-[#2f3237] bg-[#f2eee1] p-4"><div className="flex items-baseline justify-between gap-3"><p className="font-semibold">{item.place.name}</p><time className="font-mono text-sm">{item.plannedTime}</time></div><p className="mt-2 text-sm text-[#5a5d61]">{weather.condition}{weather.precipitationProbability !== null ? ` · ${Math.round(weather.precipitationProbability)}% precipitation` : ''}{weather.temperatureC !== null ? ` · ${Math.round(weather.temperatureC)}°C` : ''}</p></div>{laterCount > 0 && <p className="mt-3 text-sm text-[#5a5d61]">{laterCount} later stop{laterCount === 1 ? '' : 's'} may also be affected.</p>}<p className="mt-5 text-sm font-semibold">Delay this stop</p><div className="mt-3 grid grid-cols-3 gap-2">{WEATHER_DELAY_CHOICES.map((minutes) => <button key={minutes} type="button" onClick={() => onDelay(minutes)} className="border border-[#35383d] bg-[#2f3237] px-3 py-3 text-sm font-semibold text-[#f8f4e8] hover:bg-[#1f2227]">+{minutes} min</button>)}</div><div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={onSkip} className="h-11 border border-[#35383d] px-4 text-sm font-semibold hover:bg-[#f2eee1]">Skip stop</button><button type="button" onClick={onKeepPlan} className="h-11 px-3 text-sm font-semibold underline-offset-4 hover:underline">Keep plan</button></div></div>;
}

function SkipWeatherPreview({ item, applying, error, onApply, onCancel }: { item: ItineraryItemView; applying: boolean; error: string | null; onApply: () => void; onCancel: () => void }) {
  return <div><p className="text-sm font-semibold">Skip {item.place.name}</p><p className="mt-2 text-sm leading-6 text-[#5a5d61]">Route and remaining schedule will be recalculated.</p>{error && <p role="alert" className="mt-4 rounded-lg border border-brown-accent/25 bg-parchment px-3 py-2 text-sm leading-6 text-ink">{error}</p>}<div className="mt-5 flex gap-3"><ActionButton onClick={onApply} disabled={applying}>{applying ? 'Applying' : 'Apply changes'}</ActionButton><button type="button" onClick={onCancel} disabled={applying} className="h-11 px-3 text-sm font-semibold underline-offset-4 hover:underline">Cancel</button></div></div>;
}

function SchedulePreview({ event, schedule, applying, error, onApply, onCancel }: { event: Extract<TripChangeEvent, { type: 'stay_longer' | 'running_late' }>; schedule: { day: number; current: ItineraryItemView; later: ItineraryItemView[] }; applying: boolean; error: string | null; onApply: () => void; onCancel: () => void }) {
  const affected = event.type === 'stay_longer' ? schedule.later : [schedule.current, ...schedule.later];
  return <div><p className="text-sm font-semibold">{event.minutes} minute schedule shift</p><p className="mt-2 text-sm leading-6 text-[#5a5d61]">{event.type === 'stay_longer' ? `${schedule.current.place.name} ends ${formatTime(addMinutes(schedule.current.plannedTime, schedule.current.estimatedDurationMinutes))} → ${formatTime(addMinutes(schedule.current.plannedTime, schedule.current.estimatedDurationMinutes + event.minutes))}` : `${schedule.current.place.name} starts ${schedule.current.plannedTime} → ${formatTime(addMinutes(schedule.current.plannedTime, event.minutes))}`}</p><div className="mt-4 space-y-2">{affected.slice(0, 4).map((item) => <p key={item.id} className="text-sm"><span className="font-semibold">{item.place.name}</span><span className="text-[#5a5d61]"> {item.plannedTime} → {formatTime(addMinutes(item.plannedTime, event.minutes))}</span></p>)}</div>{error && <p role="alert" className="mt-4 rounded-lg border border-brown-accent/25 bg-parchment px-3 py-2 text-sm leading-6 text-ink">{error}</p>}<div className="mt-5 flex gap-3"><ActionButton onClick={onApply} disabled={applying}>{applying ? 'Applying' : 'Apply changes'}</ActionButton><button type="button" onClick={onCancel} disabled={applying} className="h-11 px-3 text-sm font-semibold underline-offset-4 hover:underline">Cancel</button></div></div>;
}

function addMinutes(time: string, minutes: number) { const [hours, mins] = time.split(':').map(Number); return `${String(Math.floor((hours * 60 + mins + minutes) / 60) % 24).padStart(2, '0')}:${String((hours * 60 + mins + minutes) % 60).padStart(2, '0')}`; }
function formatTime(time: string) { return time; }

function ChoiceCapture({
  prompt,
  choices,
  suffix,
  onChoose,
}: {
  prompt: string;
  choices: number[];
  suffix: string;
  onChoose: (minutes: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{prompt}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {choices.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onChoose(minutes)}
            className="border border-[#35383d] bg-[#2f3237] px-3 py-4 text-sm font-semibold text-[#f8f4e8] hover:bg-[#1f2227] active:translate-y-px"
          >
            {prompt === 'How much longer?' ? '+' : ''}
            {minutes} {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoteCapture({
  prompt,
  description,
  placeholder,
  note,
  onChange,
  onSave,
  disabled = false,
}: {
  prompt: string;
  description?: string;
  placeholder: string;
  note: string;
  onChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor="trip-change-note" className="text-sm font-semibold">
        {prompt}
      </label>
      {description && <p className="mt-2 text-sm leading-6 text-[#5a5d61]">{description}</p>}
      <Input
        id="trip-change-note"
        value={note}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={240}
        className="mt-4 h-12 rounded-none border-[#35383d]/40 bg-[#fffdf8] px-4 focus-visible:border-[#2f3237] focus-visible:ring-[#2f3237]/20"
      />
      <ActionButton className="mt-4" onClick={onSave} disabled={disabled}>
        Record change
      </ActionButton>
    </div>
  );
}

function ActionButton({
  children,
  className,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-11 border border-[#35383d] bg-[#2f3237] px-4 text-sm font-semibold text-[#f8f4e8] hover:bg-[#1f2227] disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
