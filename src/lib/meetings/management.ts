import { sha256, MeetingError, type Booking, type BookingRepository } from './repository';
import { GoogleError, meetLink, type CalendarPort } from './google';

export const revision = (row: Booking) => sha256(`${row.starts_at}|${row.ends_at}|${row.meet_url}`).slice(0,12);
export type MeetingEditor = (row: Booking) => Promise<void>;

// Called with the row lease held. A failed provider call never releases the occupied slot.
export async function reconcile(repo: BookingRepository, calendar: CalendarPort, original: Booking, now: Date, edit?: MeetingEditor) {
  let row = original;
  if (row.status === 'confirmed') {
    const event = await calendar.get(row);
    if (!event || event.status === 'cancelled') {
      row = await repo.update(row,{status:'failed',cancelled_at:now.toISOString(),cancel_requested_at:null,telegram_edit_pending:1,last_error:null});
    } else {
      if (event.extendedProperties?.private?.bookingId !== row.id) throw new MeetingError('calendar_event_changed');
      const start = Date.parse(event.start?.dateTime || ''), end = Date.parse(event.end?.dateTime || '');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new MeetingError('calendar_event_changed');
      const moved = start !== Date.parse(row.starts_at) || end !== Date.parse(row.ends_at);
      let url: string | null = null;
      try { const link = new URL(event.htmlLink || ''); if (link.protocol === 'https:' && ['calendar.google.com','www.google.com'].includes(link.hostname)) url = link.href; } catch { /* Missing link: no unsafe fallback URL. */ }
      const meet = meetLink(event) || row.meet_url;
      if (moved || url !== row.calendar_url || meet !== row.meet_url) {
        const buffer = Date.parse(row.blocked_until)-Date.parse(row.ends_at);
        row = await repo.update(row,{starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),blocked_until:new Date(end+buffer).toISOString(),
          calendar_url:url,meet_url:meet,telegram_edit_pending:1,...(moved ? {cancel_requested_at:null} : {})});
      }
      if (row.cancel_requested_at) {
        try { await calendar.remove(row,event.etag); }
        catch (error) {
          if (error instanceof GoogleError && error.code === 412) await repo.update(row,{cancel_requested_at:null,telegram_edit_pending:1});
          throw error;
        }
        row = await repo.update(row,{status:'failed',cancelled_at:now.toISOString(),cancel_requested_at:null,telegram_edit_pending:1,last_error:null});
      }
    }
  }
  if (row.telegram_edit_pending && row.telegram_message_id && edit) {
    try {
      await edit(row);
      row = await repo.update(row,{telegram_edit_pending:0,last_error:null});
    } catch {
      row = await repo.update(row,{last_error:'telegram_edit_failed',next_attempt_at:new Date(now.getTime()+60000).toISOString()});
    }
  }
  return row;
}

export async function synchronize(repo: BookingRepository, calendar: CalendarPort, original: Booking, now: Date, edit?: MeetingEditor) {
  const row = await repo.claimManagement(original.id,now);
  if (!row) throw new MeetingError('meeting_busy',409);
  try { return await reconcile(repo,calendar,row,now,edit); }
  finally { await repo.release(row); }
}

export async function cancelMeeting(repo: BookingRepository, calendar: CalendarPort, original: Booking, expectedRevision: string, now: Date, edit?: MeetingEditor) {
  let row = await repo.claimManagement(original.id,now);
  if (!row) throw new MeetingError('meeting_busy',409);
  try {
    row = await reconcile(repo,calendar,row,now,edit);
    if (row.cancelled_at) return row;
    if (row.status !== 'confirmed' || revision(row) !== expectedRevision) throw new MeetingError('meeting_changed',409);
    row = await repo.update(row,{cancel_requested_at:now.toISOString(),next_attempt_at:now.toISOString()});
    return await reconcile(repo,calendar,row,now,edit);
  } finally { await repo.release(row); }
}
