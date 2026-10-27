import type { Schedule } from './config';
export interface Interval { start: string; end: string }
export interface Slot extends Interval { day: string; time: string }
const minute = 60_000;

function parts(date: Date, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
}
export function localDay(date: Date, timezone: string): string {
  const p = parts(date, timezone); return `${p.year}-${p.month}-${p.day}`;
}
// Resolve civil time with the IANA database, not a hard-coded UTC offset.
export function civilToUtc(day: string, time: string, timezone: string): string | null {
  const target = Date.parse(`${day}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess), timezone);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    if (represented === target) return new Date(guess).toISOString();
    guess += target - represented;
  }
  return null; // A nonexistent civil time during a spring DST transition.
}
export function candidates(config: Schedule, now = new Date()): Slot[] {
  const today = localDay(now, config.timezone);
  const slots: Slot[] = [];
  const earliest = now.getTime() + config.noticeHours * 60 * minute;
  const latest = now.getTime() + config.horizonDays * 24 * 60 * minute;
  for (let d = 0; d <= config.horizonDays; d++) {
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + d);
    if (!config.weekdays.includes(date.getUTCDay() || 7)) continue;
    const day = date.toISOString().slice(0, 10);
    for (const [from, to] of config.windows) {
      const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
      for (let m = minutes(from); m + config.durationMinutes <= minutes(to); m += config.durationMinutes + config.bufferMinutes) {
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const start = civilToUtc(day, time, config.timezone);
        if (!start || Date.parse(start) < earliest || Date.parse(start) > latest) continue;
        slots.push({ start, end: new Date(Date.parse(start) + config.durationMinutes * minute).toISOString(), day, time });
      }
    }
  }
  return [...new Map(slots.map(s => [s.start, s])).values()].sort((a, b) => a.start.localeCompare(b.start));
}
export const overlaps = (slot: Interval, busy: Interval, bufferMinutes: number) =>
  Date.parse(slot.start) < Date.parse(busy.end) + bufferMinutes * minute
  && Date.parse(slot.end) + bufferMinutes * minute > Date.parse(busy.start);
export const availableSlots = (config: Schedule, busy: Interval[], now = new Date()) =>
  candidates(config, now).filter(slot => !busy.some(event => overlaps(slot, event, config.bufferMinutes)));
