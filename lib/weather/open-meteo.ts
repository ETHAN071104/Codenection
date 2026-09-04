import 'server-only';

import type { ItineraryItemView } from '@/lib/phase2/types';
import type { WeatherAtStop, WeatherDayResponse } from '@/lib/planner/types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 30 * 60 * 1000;
const weatherCache = new Map<
  string,
  { expiresAt: number; value: WeatherDayResponse }
>();

type ForecastResponse = {
  hourly?: {
    time?: unknown;
    temperature_2m?: unknown;
    precipitation_probability?: unknown;
    weather_code?: unknown;
  };
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getTripDayDate(startDate: string | null, day: number) {
  const today = new Date().toISOString().slice(0, 10);
  return addDays(startDate ?? today, day - 1) ?? today;
}

function withinForecastWindow(date: string) {
  const target = new Date(`${date}T12:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const delta = Math.round((target - today.getTime()) / 86_400_000);
  return delta >= -5 && delta <= 15;
}

export function describeWeatherCode(code: number | null) {
  if (code === null) return 'Forecast unavailable';
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Cloudy';
}

function unavailableStops(items: ItineraryItemView[]): WeatherAtStop[] {
  return items.map((item) => ({
    itemId: item.id,
    plannedTime: item.plannedTime,
    temperatureC: null,
    precipitationProbability: null,
    weatherCode: null,
    condition: 'Forecast unavailable',
  }));
}

function numberAt(value: unknown, index: number) {
  if (!Array.isArray(value)) return null;
  const number = Number(value[index]);
  return Number.isFinite(number) ? number : null;
}

export async function getWeatherForDay({
  items,
  day,
  startDate,
}: {
  items: ItineraryItemView[];
  day: number;
  startDate: string | null;
}): Promise<WeatherDayResponse> {
  const date = getTripDayDate(startDate, day);
  const coordinates = items
    .map((item) => [item.place.latitude, item.place.longitude] as const)
    .filter(
      (coordinate): coordinate is readonly [number, number] =>
        typeof coordinate[0] === 'number' &&
        Number.isFinite(coordinate[0]) &&
        typeof coordinate[1] === 'number' &&
        Number.isFinite(coordinate[1]),
    );
  const cacheKey = `${date}:${items
    .map(
      (item) =>
        `${item.id}:${item.plannedTime}:${item.place.latitude},${item.place.longitude}`,
    )
    .join('|')}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (coordinates.length !== items.length || !withinForecastWindow(date)) {
    return { day, date, stops: unavailableStops(items) };
  }

  const url = new URL(FORECAST_URL);
  url.searchParams.set(
    'latitude',
    coordinates.map((coordinate) => coordinate[0]).join(','),
  );
  url.searchParams.set(
    'longitude',
    coordinates.map((coordinate) => coordinate[1]).join(','),
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,precipitation_probability,weather_code',
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('WEATHER_UNAVAILABLE');
    const raw = (await response.json()) as ForecastResponse | ForecastResponse[];
    const forecasts = Array.isArray(raw) ? raw : [raw];
    if (forecasts.length !== items.length) throw new Error('WEATHER_INVALID');

    const stops = items.map((item, itemIndex) => {
      const forecast = forecasts[itemIndex];
      const times = forecast?.hourly?.time;
      const targetMinutes = Number(item.plannedTime.slice(0, 2)) * 60 +
        Number(item.plannedTime.slice(3, 5));
      let bestIndex = -1;
      let bestDelta = Number.POSITIVE_INFINITY;
      if (Array.isArray(times)) {
        times.forEach((time, index) => {
          if (typeof time !== 'string' || !time.startsWith(`${date}T`)) return;
          const hour = Number(time.slice(11, 13));
          const minute = Number(time.slice(14, 16));
          const delta = Math.abs(hour * 60 + minute - targetMinutes);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIndex = index;
          }
        });
      }
      const temperatureC = numberAt(
        forecast?.hourly?.temperature_2m,
        bestIndex,
      );
      const precipitationProbability = numberAt(
        forecast?.hourly?.precipitation_probability,
        bestIndex,
      );
      const weatherCode = numberAt(
        forecast?.hourly?.weather_code,
        bestIndex,
      );
      return {
        itemId: item.id,
        plannedTime: item.plannedTime,
        temperatureC,
        precipitationProbability,
        weatherCode,
        condition: describeWeatherCode(weatherCode),
      } satisfies WeatherAtStop;
    });
    const value = { day, date, stops };
    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });
    return value;
  } catch {
    return { day, date, stops: unavailableStops(items) };
  }
}
