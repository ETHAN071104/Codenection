export type MapDaySelection = 'all' | number;

export function routeColorForDay(dayNumber: number) {
  const normalizedDay = Math.max(1, Math.floor(dayNumber));
  const hue = Math.round((22 + (normalizedDay - 1) * 137.508) % 360);
  const lightness = 38 + ((normalizedDay - 1) % 3) * 4;
  return `hsl(${hue} 42% ${lightness}%)`;
}

export function visibleRouteDayNumbers(
  dayNumbers: number[],
  selection: MapDaySelection,
) {
  return selection === 'all'
    ? [...dayNumbers]
    : dayNumbers.filter((day) => day === selection);
}

export function nextAiPanelState(current: boolean, selection: MapDaySelection) {
  return selection === 'all' ? false : !current;
}
