import type { Schedule } from './config';
import { BookingRepository, MeetingError, fingerprint, type Booking } from './repository';
import { candidates, overlaps } from './schedule';
import { GoogleError, meetLink, type CalendarPort } from './google';
import type { BookingInput } from './validation';
import type { MeetingNotifier } from './telegram';
import { reconcile, synchronize, type MeetingEditor } from './management';

export class MeetingService {
  constructor(public repo: BookingRepository, private calendar: CalendarPort, private notify: MeetingNotifier,
    private schedule: Schedule, private calendarId: string, private now: () => Date = () => new Date(), private edit?: MeetingEditor) {}

  async synchronizeCalendar() {
    const rows = await this.repo.confirmed(this.now());
    if (!rows.length) return;
    const started = Date.now();
    const snapshot = await this.calendar.inspect?.(this.now());
    const changed = rows.filter(row => {
      const event = snapshot?.get(row.event_id);
      return row.cancel_requested_at || row.telegram_edit_pending || !event || event.status === 'cancelled'
        || event.extendedProperties?.private?.bookingId !== row.id || Date.parse(event.start?.dateTime || '') !== Date.parse(row.starts_at)
        || Date.parse(event.end?.dateTime || '') !== Date.parse(row.ends_at) || (event.htmlLink || null) !== row.calendar_url
        || (meetLink(event) || row.meet_url) !== row.meet_url;
    });
    for (let i=0;i<changed.length;i+=5) {
      if (Date.now()-started > 20000) throw new MeetingError('calendar_sync_pending');
      await Promise.all(changed.slice(i,i+5).map(row => synchronize(this.repo,this.calendar,row,this.now(),this.edit)));
    }
  }

  async availability() {
    await this.synchronizeCalendar();
    const now = this.now(); const slots = candidates(this.schedule,now);
    if (!slots.length) return {slots:[],timezone:this.schedule.timezone,duration:this.schedule.durationMinutes};
    const from = new Date(Date.parse(slots[0].start)-this.schedule.bufferMinutes*60_000).toISOString();
    const to = new Date(Date.parse(slots.at(-1)!.end)+this.schedule.bufferMinutes*60_000).toISOString();
    const [busy,active] = await Promise.all([this.calendar.busy(from,to),this.repo.active(from,to)]);
    return {timezone:this.schedule.timezone,duration:this.schedule.durationMinutes,slots:slots.filter(slot =>
      !busy.some(b=>overlaps(slot,b,this.schedule.bufferMinutes))
      && !active.some(b=>Date.parse(slot.start)<Date.parse(b.end) && Date.parse(slot.end)+this.schedule.bufferMinutes*60_000>Date.parse(b.start)))};
  }
  async reserve(input: BookingInput) {
    const previous = await this.repo.get(input.key);
    if (previous) {
      this.repo.authorize(previous,input.token,fingerprint(input));
      return previous.status === 'confirmed' ? synchronize(this.repo,this.calendar,previous,this.now(),this.edit) : this.advance(previous);
    }
    await this.synchronizeCalendar();
    const slot = candidates(this.schedule,this.now()).find(s=>s.start===new Date(input.start).toISOString());
    if (!slot) throw new MeetingError('invalid_slot',409);
    const busy = await this.calendar.busy(new Date(Date.parse(slot.start)-this.schedule.bufferMinutes*60_000).toISOString(),new Date(Date.parse(slot.end)+this.schedule.bufferMinutes*60_000).toISOString());
    if (busy.some(b=>overlaps(slot,b,this.schedule.bufferMinutes))) throw new MeetingError('slot_taken',409);
    const row = await this.repo.create(input,slot,this.schedule,this.calendarId,this.now());
    return this.advance(row);
  }
  async status(key: string, token: string) {
    const row = await this.repo.get(key);
    if (!row) throw new MeetingError('not_found',404);
    this.repo.authorize(row,token);
    if (row.status === 'confirmed') return synchronize(this.repo,this.calendar,row,this.now(),this.edit);
    return this.advance(row);
  }
  async advance(original: Booking): Promise<Booking> {
    let row = await this.repo.claim(original.id,this.now());
    if (!row) return await this.repo.byId(original.id);
    try {
      if (row.cancel_requested_at || row.telegram_edit_pending) row = await reconcile(this.repo,this.calendar,row,this.now(),this.edit);
      if (row.cancelled_at) return row;
      if (row.status === 'confirmed') {
        await this.deliver(row); return await this.repo.byId(row.id);
      }
      if (!row.event_attempted && (row.deadline_at <= this.now().toISOString() || row.status === 'cancelling')) {
        return await this.repo.update(row,{status:'failed',meet_status:'failed',last_error:'booking_expired'});
      }
      let event = await this.calendar.get(row);
      if (event && event.status !== 'cancelled' && (event.extendedProperties?.private?.bookingId !== row.id
        || Date.parse(event.start?.dateTime || '') !== Date.parse(row.starts_at)
        || Date.parse(event.end?.dateTime || '') !== Date.parse(row.ends_at))) {
        throw new MeetingError('calendar_event_changed'); // Never delete an unrelated or manually changed event.
      }
      if (event?.status === 'cancelled') {
        return await this.repo.update(row,{status:'failed',meet_status:'failed',last_error:'calendar_cancelled'});
      }
      if (row.deadline_at <= this.now().toISOString() || row.status === 'cancelling') {
        row = await this.repo.update(row,{status:'cancelling'});
        // An ambiguous INSERT must be reconciled using the same event ID. Materialize then
        // delete it if needed; never free a slot on the strength of a timeout or one 404.
        if (!event && row.event_attempted) event = await this.calendar.create(row);
        if (event) await this.calendar.remove(row);
        return await this.repo.update(row,{status:'failed',meet_status:'failed',last_error:'booking_expired'});
      }
      if (!event) {
        const buffer = (Date.parse(row.blocked_until)-Date.parse(row.ends_at))/60_000;
        const busy = await this.calendar.busy(new Date(Date.parse(row.starts_at)-buffer*60_000).toISOString(),row.blocked_until);
        const interval = {start:row.starts_at,end:row.ends_at};
        if (busy.some(b=>overlaps(interval,b,buffer))) {
          if (row.event_attempted) return await this.repo.update(row,{status:'cancelling',last_error:'slot_taken'});
          return await this.repo.update(row,{status:'failed',meet_status:'failed',last_error:'slot_taken'});
        }
        const previouslyAttempted = row.event_attempted;
        row = await this.repo.update(row,{event_attempted:1});
        try { event = await this.calendar.create(row); }
        catch (error) {
          if (!previouslyAttempted && error instanceof GoogleError && [400,401,403,422].includes(error.code)) {
            return await this.repo.update(row,{status:'failed',event_attempted:0,meet_status:'failed',last_error:`google_${error.code}`});
          }
          throw error;
        }
      }
      if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') {
        row = await this.repo.update(row,{status:'cancelling',meet_status:'failed',last_error:'conference_failed'});
        await this.calendar.remove(row);
        return await this.repo.update(row,{status:'failed'});
      }
      const link = meetLink(event);
      if (!link) return await this.repo.update(row,{next_attempt_at:new Date(this.now().getTime()+5000).toISOString()});
      row = await this.repo.update(row,{meet_url:link,meet_status:'ready',calendar_url:event.htmlLink || null});
      await this.calendar.invite(row,event);
      row = await this.repo.update(row,{status:'confirmed',last_error:null});
      await this.deliver(row);
      return await this.repo.byId(row.id);
    } catch (error) {
      // Persist recovery before returning. Google failures must not turn into a false success.
      const delay = Math.min(3600,Math.pow(2,Math.min(row.attempts,9))*5);
      await this.repo.update(row,{last_error:error instanceof GoogleError ? `google_${error.code}` : error instanceof MeetingError ? error.code : 'provider_unavailable',
        next_attempt_at:new Date(this.now().getTime()+delay*1000).toISOString()});
      return await this.repo.byId(row.id);
    } finally { await this.repo.release(row); }
  }
  private async deliver(row: Booking) {
    if (row.telegram_status==='sent' || row.telegram_status==='uncertain') return;
    if (row.telegram_status==='sending') {
      // The previous worker died after beginning sendMessage. It may have delivered.
      await this.repo.update(row,{telegram_status:'uncertain',last_error:'telegram_delivery_unknown'}); return;
    }
    row = await this.repo.update(row,{telegram_status:'sending',telegram_attempts:row.telegram_attempts+1});
    let result;
    try { result = await this.notify(row); }
    catch { await this.repo.update(row,{telegram_status:'uncertain',last_error:'telegram_delivery_unknown'}); return; }
    if (result.status==='sent') await this.repo.update(row,{telegram_status:'sent',telegram_message_id:result.providerMessageId,telegram_sent_at:result.timestamp,last_error:null});
    else await this.repo.update(row,{telegram_status:result.retrySafe ? 'pending' : 'uncertain',last_error:`telegram_${result.reason}`,
      next_attempt_at:new Date(this.now().getTime()+Math.min(3600,60*Math.pow(2,Math.min(row.telegram_attempts,6)))*1000).toISOString()});
  }
  async recover() {
    await this.synchronizeCalendar();
    const start = Date.now(); let processed = 0;
    for (const row of await this.repo.due(this.now())) {
      if (Date.now()-start > 25_000) break;
      await this.advance(row); processed++;
    }
    await this.repo.db.run('DELETE FROM meeting_rate_limits WHERE expires_at < ?',this.now().toISOString());
    return processed;
  }
}
export const publicBooking = (row: Booking) => ({
  id:row.id,status:row.cancelled_at ? 'cancelled' : row.status === 'cancelling' ? 'pending' : row.status,
  start:row.starts_at,end:row.ends_at,timezone:row.timezone,
  meetUrl:row.status==='confirmed' ? row.meet_url : null,
});
