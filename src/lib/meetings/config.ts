import { z } from 'zod';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleSchema = z.object({
  timezone: z.string().default('Europe/Madrid').refine(value => { try { new Intl.DateTimeFormat('es', { timeZone: value }); return true; } catch { return false; } }),
  durationMinutes: z.number().int().min(15).max(120).default(30),
  bufferMinutes: z.number().int().min(0).max(60).default(15),
  noticeHours: z.number().int().min(24).max(168).default(24),
  horizonDays: z.number().int().min(1).max(60).default(30),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  windows: z.array(z.tuple([clock, clock])).min(1).max(4).default([['10:00', '14:00'], ['16:00', '18:00']]),
}).refine(c => c.windows.every(([start, end]) => start < end), 'Invalid working hours');
export type Schedule = z.infer<typeof scheduleSchema>;
export const defaultSchedule = scheduleSchema.parse({});
export const readSchedule = (): Schedule => scheduleSchema.parse(JSON.parse(process.env.BOOKING_SCHEDULE_JSON || '{}'));

export function meetingConfig() {
  const env = process.env;
  const config = {
    clientId: env.BOOKING_GOOGLE_CLIENT_ID || '', clientSecret: env.BOOKING_GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.BOOKING_GOOGLE_REFRESH_TOKEN || '', calendarId: env.BOOKING_GOOGLE_CALENDAR_ID || '',
    busyCalendars: (env.BOOKING_BUSY_CALENDAR_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    rateSecret: env.BOOKING_RATE_SECRET || '', cronSecret: env.CRON_SECRET || '',
    organizerName: (env.BOOKING_ORGANIZER_NAME || '').trim().slice(0, 80),
  };
  if (env.BOOKING_ENABLED !== 'true' || !config.clientId || !config.clientSecret || !config.refreshToken
    || !config.calendarId || config.rateSecret.length < 32 || config.cronSecret.length < 32
    || !env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new Error('meeting_unconfigured');
  if (!(env.VERCEL === '1' && env.VERCEL_ENV === 'production') && env.BOOKING_GOOGLE_TEST_CALENDAR_ID !== config.calendarId) {
    throw new Error('meeting_test_calendar_required');
  }
  return config;
}
export type MeetingConfig = ReturnType<typeof meetingConfig>;
