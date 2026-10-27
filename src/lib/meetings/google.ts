import type { MeetingConfig } from './config';
import type { Booking } from './repository';
import type { Interval } from './schedule';

export class GoogleError extends Error {
  constructor(public code: number) { super(`google_${code}`); }
}
export interface CalendarEvent {
  id: string; etag?: string; status?: string; htmlLink?: string;
  extendedProperties?: { private?: { bookingId?: string } };
  start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: { email: string }[];
  conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType: string; uri: string }[] };
}
export interface CalendarPort {
  inspect?(now: Date): Promise<Map<string,CalendarEvent>>;
  busy(from: string, to: string): Promise<Interval[]>;
  get(row: Booking): Promise<CalendarEvent | null>;
  create(row: Booking): Promise<CalendarEvent>;
  invite(row: Booking, event: CalendarEvent): Promise<void>;
  remove(row: Booking, etag?: string): Promise<void>;
}
export function meetLink(event: CalendarEvent): string | null {
  const link = event.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri;
  if (!link) return null;
  try { const url = new URL(link); return url.protocol === 'https:' && url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) ? url.href : null; } catch { return null; }
}

export class GoogleCalendar implements CalendarPort {
  private token?: string;
  constructor(private config: MeetingConfig, private request: typeof fetch = fetch) {}
  private async accessToken() {
    if (this.token) return this.token;
    const response = await this.request('https://oauth2.googleapis.com/token', { method:'POST',
      body:new URLSearchParams({ client_id:this.config.clientId,client_secret:this.config.clientSecret,refresh_token:this.config.refreshToken,grant_type:'refresh_token' }),
      signal:AbortSignal.timeout(5000) });
    if (!response.ok) throw new GoogleError(response.status);
    const data = await response.json();
    if (!data.access_token) throw new GoogleError(502);
    return this.token = data.access_token as string;
  }
  private async api(path: string, method = 'GET', body?: unknown, etag?: string) {
    const token = await this.accessToken();
    const response = await this.request(`https://www.googleapis.com/calendar/v3/${path}`, {
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(etag ? {'If-Match':etag} : {})},
      body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new GoogleError(response.status);
    return response.status === 204 ? null : response.json();
  }
  private path(row: Booking) { return `calendars/${encodeURIComponent(row.calendar_id)}/events/${row.event_id}`; }
  async inspect(now: Date) {
    const events = new Map<string,CalendarEvent>();
    let pageToken = ''; const started = Date.now();
    do {
      if (Date.now()-started > 15000) throw new GoogleError(503);
      const query = new URLSearchParams({timeMin:now.toISOString(),maxResults:'2500',showDeleted:'true',...(pageToken ? {pageToken} : {})});
      const data = await this.api(`calendars/${encodeURIComponent(this.config.calendarId)}/events?${query}`);
      if (!Array.isArray(data.items)) throw new GoogleError(502);
      for (const event of data.items as CalendarEvent[]) events.set(event.id,event);
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return events;
  }
  async busy(from: string, to: string): Promise<Interval[]> {
    const ids = [...new Set([this.config.calendarId,...this.config.busyCalendars])];
    const data = await this.api('freeBusy','POST',{timeMin:from,timeMax:to,items:ids.map(id=>({id}))});
    const intervals: Interval[] = [];
    for (const id of ids) {
      const item = data.calendars?.[id];
      if (!item || item.errors?.length || !Array.isArray(item.busy)) throw new GoogleError(503);
      for (const entry of item.busy) {
        if (!Number.isFinite(Date.parse(entry.start)) || !Number.isFinite(Date.parse(entry.end))) throw new GoogleError(502);
        intervals.push({start:entry.start,end:entry.end});
      }
    }
    return intervals;
  }
  async get(row: Booking): Promise<CalendarEvent | null> {
    try { return await this.api(this.path(row)); }
    catch (e) { if (e instanceof GoogleError && (e.code===404 || e.code===410)) return null; throw e; }
  }
  async create(row: Booking): Promise<CalendarEvent> {
    try {
      return await this.api(`calendars/${encodeURIComponent(row.calendar_id)}/events?conferenceDataVersion=1&sendUpdates=none`,'POST',{
        id:row.event_id,summary:'Reunión con Altaria Lights',
        description:`Reserva ${row.id}. La asistencia se confirma por WhatsApp.`,
        start:{dateTime:row.starts_at,timeZone:row.timezone},end:{dateTime:row.ends_at,timeZone:row.timezone},
        transparency:'opaque',visibility:'private',extendedProperties:{private:{bookingId:row.id}},
        conferenceData:{createRequest:{requestId:row.event_id,conferenceSolutionKey:{type:'hangoutsMeet'}}},
      });
    } catch (e) {
      if (e instanceof GoogleError && e.code===409) { const existing = await this.get(row); if (existing) return existing; }
      throw e;
    }
  }
  async invite(row: Booking, event: CalendarEvent) {
    if (event.attendees?.some(a => a.email.toLowerCase() === row.email)) return;
    await this.api(`${this.path(row)}?conferenceDataVersion=1&sendUpdates=all`,'PATCH',{
      attendees:[{email:row.email}],description:`Reserva ${row.id}. ${row.name} · ${row.business}.\nGoogle Meet: ${row.meet_url}\nSi necesitas cambiar la cita, responde a la invitación.`,
    },event.etag);
  }
  async remove(row: Booking, etag?: string) {
    try { await this.api(`${this.path(row)}?sendUpdates=all`,'DELETE',undefined,etag); }
    catch (e) { if (!(e instanceof GoogleError && (e.code===404 || e.code===410))) throw e; }
  }
}
