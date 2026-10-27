import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BookingRepository, type Booking } from './repository';
import { MeetingService, publicBooking } from './service';
import { defaultSchedule } from './config';
import { availableSlots, candidates, civilToUtc, overlaps } from './schedule';
import { bookingSchema, normalizePhone, type BookingInput } from './validation';
import { GoogleCalendar, GoogleError, meetLink, type CalendarEvent, type CalendarPort } from './google';
import { meetingMessage } from './telegram';
import { readBody, validCron } from './http';
import { cancelMeeting, revision, synchronize } from './management';
import { meetingKeyboard } from './telegram';
import { POST as telegramWebhook } from '../../pages/api/reuniones/telegram';

const databases: DatabaseSync[] = [];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.unstubAllEnvs();});
const baseTime = '2026-10-27T08:00:00.000Z';
function fixture() {
  // SQLite is an in-memory SQL test harness only; the application's only database is Turso.
  const sqlite = new DatabaseSync(':memory:');databases.push(sqlite);
  sqlite.exec(readFileSync('migrations/023_meeting_bookings.sql','utf8'));
  sqlite.exec(readFileSync('migrations/024_meeting_management.sql','utf8'));
  const args = (values: unknown[]) => values.length===1 && Array.isArray(values[0]) ? values[0] : values;
  const db = {
    get:async(sql:string,...values:unknown[])=>sqlite.prepare(sql).get(...args(values)),
    all:async(sql:string,...values:unknown[])=>sqlite.prepare(sql).all(...args(values)),
    run:async(sql:string,...values:unknown[])=>sqlite.prepare(sql).run(...args(values)),
  } as unknown as ConstructorParameters<typeof BookingRepository>[0];
  const repo=new BookingRepository(db);
  let now=new Date(baseTime);let event: CalendarEvent|null=null;
  const calendar: CalendarPort = {
    busy:vi.fn(async()=>[]),get:vi.fn(async()=>event),
    create:vi.fn(async(row:Booking)=>{
      event={id:row.event_id,etag:'synthetic-etag',extendedProperties:{private:{bookingId:row.id}},start:{dateTime:row.starts_at},end:{dateTime:row.ends_at},
        conferenceData:{createRequest:{status:{statusCode:'success'}},entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}};
      return event;
    }),
    invite:vi.fn(async(row:Booking)=>{if(event)event.attendees=[{email:row.email}];}),remove:vi.fn(async()=>{event=null;}),
  };
  const notify=vi.fn(async()=>({status:'sent' as const,provider:'telegram' as const,notificationType:'meeting_booked' as const,providerMessageId:123,timestamp:now.toISOString()}));
  const service=new MeetingService(repo,calendar,notify,defaultSchedule,'synthetic-calendar',()=>now);
  const input:BookingInput={key:randomUUID(),token:'a'.repeat(64),start:candidates(defaultSchedule,now)[0].start,
    name:'Cliente TEST',business:'Negocio TEST',email:'synthetic@example.test',phone:'+34612345678',comment:'Comentario sintético',privacy:true,website:'',startedAt:now.getTime()-5000};
  return {sqlite,repo,service,calendar,notify,input,tick:(ms:number)=>{now=new Date(now.getTime()+ms);},event:()=>event,setEvent:(value:CalendarEvent|null)=>{event=value;}};
}

describe('organizer meeting management',()=>{
  it('imports a Calendar move, releases the old slot and updates the notification',async()=>{
    const f=fixture(); const row=await f.service.reserve(f.input); const edit=vi.fn(async()=>{});
    const event=f.event()!; const start=new Date(Date.parse(row.starts_at)+86400000).toISOString();
    f.setEvent({...event,start:{dateTime:start},end:{dateTime:new Date(Date.parse(start)+1800000).toISOString()},htmlLink:'https://calendar.google.com/calendar/event?eid=example'});
    const updated=await synchronize(f.repo,f.calendar,row,new Date(baseTime),edit);
    expect(updated.starts_at).toBe(start); expect(edit).toHaveBeenCalledOnce(); expect(updated.telegram_edit_pending).toBe(0);
    expect((await f.repo.active(row.starts_at,row.ends_at))).toHaveLength(0);
    expect((await f.repo.active(updated.starts_at,updated.ends_at))).toHaveLength(1);
  });
  it('cancels once, notifies with the existing message and frees the slot',async()=>{
    const f=fixture(); const row=await f.service.reserve(f.input); const edit=vi.fn(async()=>{});
    const cancelled=await cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime),edit);
    expect(cancelled.cancelled_at).toBeTruthy();expect(publicBooking(cancelled).status).toBe('cancelled');
    expect(f.calendar.remove).toHaveBeenCalledWith(expect.objectContaining({id:row.id}),'synthetic-etag');
    expect(await f.repo.active(row.starts_at,row.ends_at)).toHaveLength(0);
    expect(edit).toHaveBeenCalledOnce();expect(f.notify).toHaveBeenCalledOnce();
  });
  it('does not delete after the event was moved since confirmation',async()=>{
    const f=fixture(); const row=await f.service.reserve(f.input); const event=f.event()!;
    f.setEvent({...event,start:{dateTime:new Date(Date.parse(row.starts_at)+86400000).toISOString()},end:{dateTime:new Date(Date.parse(row.ends_at)+86400000).toISOString()}});
    await expect(cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime))).rejects.toMatchObject({code:'meeting_changed'});
    expect(f.calendar.remove).not.toHaveBeenCalled();expect((await f.repo.byId(row.id)).status).toBe('confirmed');
  });
  it('retains the occupied slot on delete failure, then retries safely',async()=>{
    const f=fixture(); const row=await f.service.reserve(f.input);
    vi.mocked(f.calendar.remove).mockRejectedValueOnce(new GoogleError(503));
    await expect(cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime))).rejects.toThrow();
    const pending=await f.repo.byId(row.id);expect(pending.cancel_requested_at).toBeTruthy();expect(pending.status).toBe('confirmed');
    expect(await f.repo.active(row.starts_at,row.ends_at)).toHaveLength(1);
    const done=await f.service.advance(pending); expect(done.cancelled_at).toBeTruthy();expect(done.cancel_requested_at).toBeNull();
  });
  it('reconciles an ambiguous delete without recreating or deleting twice',async()=>{
    const f=fixture(); const row=await f.service.reserve(f.input);
    vi.mocked(f.calendar.remove).mockImplementationOnce(async()=>{f.setEvent(null);throw new GoogleError(503);});
    await expect(cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime))).rejects.toThrow();
    const done=await f.service.advance(await f.repo.byId(row.id));expect(done.cancelled_at).toBeTruthy();
    expect(f.calendar.create).toHaveBeenCalledOnce();expect(f.calendar.remove).toHaveBeenCalledOnce();
  });
  it('clears deletion intent when an ETag precondition fails',async()=>{
    const f=fixture();const row=await f.service.reserve(f.input);
    vi.mocked(f.calendar.remove).mockRejectedValueOnce(new GoogleError(412));
    await expect(cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime))).rejects.toThrow();
    expect((await f.repo.byId(row.id)).cancel_requested_at).toBeNull();
  });
  it('keeps a durable message edit retry after cancellation',async()=>{
    const f=fixture();const row=await f.service.reserve(f.input);const edit=vi.fn(async()=>{throw new Error('timeout');});
    const cancelled=await cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime),edit);
    expect(cancelled.cancelled_at).toBeTruthy();expect(cancelled.telegram_edit_pending).toBe(1);
    expect(cancelled.last_error).toBe('telegram_edit_failed');
  });
  it('does not delete an unrelated Calendar event',async()=>{
    const f=fixture();const row=await f.service.reserve(f.input);
    f.setEvent({...f.event()!,extendedProperties:{private:{bookingId:'someone-else'}}});
    await expect(cancelMeeting(f.repo,f.calendar,row,revision(row),new Date(baseTime))).rejects.toMatchObject({code:'calendar_event_changed'});
    expect(f.calendar.remove).not.toHaveBeenCalled();
  });
  it('provides two management buttons and removes all actions on cancellation',async()=>{
    const f=fixture();const row=await f.service.reserve(f.input);
    vi.stubEnv('BOOKING_TELEGRAM_OWNER_ID','123');vi.stubEnv('BOOKING_TELEGRAM_WEBHOOK_SECRET','s'.repeat(64));
    row.calendar_url='https://calendar.google.com/calendar/event?eid=example';
    const buttons=meetingKeyboard(row).flat();expect(buttons.map(b=>b.text)).toEqual(['Abrir WhatsApp con el mensaje','Modificar reunión','Eliminar reunión']);
    const callback=buttons[2] as {callback_data:string};expect(Buffer.byteLength(callback.callback_data)).toBeLessThanOrEqual(64);
    row.cancelled_at=baseTime;expect(meetingKeyboard(row)).toEqual([]);
  });
  it('rejects unauthenticated webhook calls and ignores other Telegram users',async()=>{
    vi.stubEnv('BOOKING_TELEGRAM_WEBHOOK_SECRET','s'.repeat(64));vi.stubEnv('BOOKING_TELEGRAM_OWNER_ID','123');vi.stubEnv('BOOKING_TEST_TELEGRAM_CHAT_ID','-100');
    const call=(headers:Record<string,string>,body:object)=>telegramWebhook({request:new Request('https://example.test/api/reuniones/telegram',{method:'POST',headers,body:JSON.stringify(body)})} as never);
    expect((await call({},{})).status).toBe(403);
    expect((await call({'x-telegram-bot-api-secret-token':'s'.repeat(64)},{callback_query:{from:{id:999},message:{chat:{id:-100}},data:'del:123'}})).status).toBe(200);
  });
});

describe('availability and time zones',()=>{
  it('keeps 10:00 Madrid across the spring and autumn DST changes',()=>{
    expect(civilToUtc('2026-03-27','10:00','Europe/Madrid')).toBe('2026-03-27T09:00:00.000Z');
    expect(civilToUtc('2026-03-30','10:00','Europe/Madrid')).toBe('2026-03-30T08:00:00.000Z');
    expect(civilToUtc('2026-10-23','10:00','Europe/Madrid')).toBe('2026-10-23T08:00:00.000Z');
    expect(civilToUtc('2026-10-26','10:00','Europe/Madrid')).toBe('2026-10-26T09:00:00.000Z');
    expect(civilToUtc('2026-03-29','02:30','Europe/Madrid')).toBeNull();
  });
  it('respects notice, horizon, weekdays and the 15-minute buffer',()=>{
    const now=new Date(baseTime),slots=candidates(defaultSchedule,now);
    expect(slots.length).toBeGreaterThan(20);
    for(const slot of slots){expect(Date.parse(slot.start)).toBeGreaterThanOrEqual(now.getTime()+86400000);expect(Date.parse(slot.start)).toBeLessThanOrEqual(now.getTime()+30*86400000);expect([0,6]).not.toContain(new Date(slot.start).getUTCDay());}
    expect(overlaps({start:'2026-10-28T10:00Z',end:'2026-10-28T10:30Z'},{start:'2026-10-28T10:40Z',end:'2026-10-28T11:00Z'},15)).toBe(true);
    expect(availableSlots(defaultSchedule,[{start:slots[0].start,end:slots[0].end}],now)).not.toContainEqual(slots[0]);
    expect(civilToUtc('2026-10-28','10:00','America/New_York')).toBe('2026-10-28T14:00:00.000Z');
  });
});
describe('booking saga with real SQL constraints and mocked providers',()=>{
  it('confirms with Meet, blocks immediately and does not recreate on replay',async()=>{
    const f=fixture();const first=await f.service.reserve(f.input);
    expect(first.status).toBe('confirmed');expect(first.meet_url).toMatch(/^https:\/\/meet.google.com\//);
    expect(f.notify).toHaveBeenCalledOnce();expect(f.calendar.create).toHaveBeenCalledOnce();
    expect((await f.service.reserve(f.input)).id).toBe(first.id);
    expect(f.calendar.create).toHaveBeenCalledOnce();expect(f.notify).toHaveBeenCalledOnce();
    expect(JSON.stringify(await f.service.availability())).not.toContain('synthetic@example.test');
    expect((await f.service.availability()).slots.some(s=>s.start===first.starts_at)).toBe(false);
    expect(publicBooking(first)).not.toHaveProperty('email');
  });
  it('allows only one of two concurrent users, enforced by the SQL trigger',async()=>{
    const f=fixture();const results=await Promise.allSettled([f.service.reserve(f.input),f.service.reserve({...f.input,key:randomUUID(),token:'b'.repeat(64)})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('slot_taken');
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM meeting_bookings').get()?.n).toBe(1);
  });
  it('deduplicates concurrent identical submissions',async()=>{
    const f=fixture();const results=await Promise.all([f.service.reserve(f.input),f.service.reserve(f.input)]);
    expect(results[0].id).toBe(results[1].id);expect(f.calendar.create).toHaveBeenCalledOnce();
  });
  it('rejects overlap with the buffer at the SQL layer',async()=>{
    const f=fixture();await f.service.reserve(f.input);
    const slot={...candidates(defaultSchedule,new Date(baseTime))[0]};
    slot.start=new Date(Date.parse(slot.end)+5*60000).toISOString();slot.end=new Date(Date.parse(slot.start)+30*60000).toISOString();
    await expect(f.repo.create({...f.input,key:randomUUID()},slot,defaultSchedule,'synthetic',new Date(baseTime))).rejects.toMatchObject({code:'slot_taken'});
  });
  it('does not reveal a booking for a wrong token or accept a changed retry',async()=>{
    const f=fixture();await f.service.reserve(f.input);
    await expect(f.service.status(f.input.key,'b'.repeat(64))).rejects.toMatchObject({status:404});
    await expect(f.service.reserve({...f.input,name:'Different'})).rejects.toMatchObject({code:'request_changed'});
  });
  it('rejects Google busy periods and checks again after reserving',async()=>{
    const f=fixture();const busy=[{start:f.input.start,end:new Date(Date.parse(f.input.start)+30*60000).toISOString()}];
    vi.mocked(f.calendar.busy).mockResolvedValueOnce(busy);
    await expect(f.service.reserve(f.input)).rejects.toMatchObject({code:'slot_taken'});
    expect(f.calendar.create).not.toHaveBeenCalled();
    vi.mocked(f.calendar.busy).mockResolvedValueOnce([]).mockResolvedValueOnce(busy);
    expect((await f.service.reserve(f.input)).status).toBe('failed');
  });
  it('keeps an asynchronous conference pending, then confirms with the same event',async()=>{
    const f=fixture();
    vi.mocked(f.calendar.create).mockReset().mockImplementation(async row=>{const event={id:row.event_id,extendedProperties:{private:{bookingId:row.id}},start:{dateTime:row.starts_at},end:{dateTime:row.ends_at},conferenceData:{createRequest:{status:{statusCode:'pending'}}}};f.setEvent(event);return event;});
    const row=await f.service.reserve(f.input);expect(row.status).toBe('pending');expect(publicBooking(row).meetUrl).toBeNull();expect(f.notify).not.toHaveBeenCalled();
    f.event()!.conferenceData={createRequest:{status:{statusCode:'success'}},entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]};
    f.tick(6000);expect((await f.service.status(f.input.key,f.input.token)).status).toBe('confirmed');expect(f.calendar.create).toHaveBeenCalledOnce();
  });
  it('recovers an accepted Google insert whose response was lost without duplicating it',async()=>{
    const f=fixture(),create=vi.mocked(f.calendar.create).getMockImplementation()!;
    vi.mocked(f.calendar.create).mockImplementationOnce(async row=>{await create(row);throw new Error('response_lost');});
    expect((await f.service.reserve(f.input)).status).toBe('pending');f.tick(60_000);
    expect((await f.service.status(f.input.key,f.input.token)).status).toBe('confirmed');expect(f.calendar.create).toHaveBeenCalledOnce();
  });
  it('cancels a failed conference before freeing the slot',async()=>{
    const f=fixture(),create=vi.mocked(f.calendar.create).getMockImplementation()!;
    vi.mocked(f.calendar.create).mockImplementation(async row=>{const e=await create(row);e.conferenceData={createRequest:{status:{statusCode:'failure'}}};return e;});
    vi.mocked(f.calendar.remove).mockRejectedValueOnce(new Error('unavailable'));
    expect((await f.service.reserve(f.input)).status).toBe('cancelling');
    f.tick(60_000);expect((await f.service.status(f.input.key,f.input.token)).status).toBe('failed');expect(f.calendar.remove).toHaveBeenCalledTimes(2);expect(f.notify).not.toHaveBeenCalled();
  });
  it('reconciles an unknown creation after its deadline before releasing the hold',async()=>{
    const f=fixture();vi.mocked(f.calendar.create).mockRejectedValueOnce(new Error('network'));
    expect((await f.service.reserve(f.input)).status).toBe('pending');f.tick(16*60_000);
    const result=await f.service.status(f.input.key,f.input.token);expect(result.status).toBe('failed');expect(f.calendar.remove).toHaveBeenCalledOnce();expect(f.calendar.invite).not.toHaveBeenCalled();
  });
  it('releases a definitively rejected first insert without leaving an eternal hold',async()=>{
    const f=fixture();vi.mocked(f.calendar.create).mockRejectedValueOnce(new GoogleError(403));
    const row=await f.service.reserve(f.input);expect(row.status).toBe('failed');expect(row.event_attempted).toBe(0);
    expect(f.notify).not.toHaveBeenCalled();expect(f.calendar.remove).not.toHaveBeenCalled();
  });
  it('expires a hold without calling Google when no event creation was ever attempted',async()=>{
    const f=fixture();const row=await f.repo.create(f.input,candidates(defaultSchedule,new Date(baseTime))[0],defaultSchedule,'synthetic',new Date(baseTime));
    f.tick(16*60_000);expect((await f.service.advance(row)).status).toBe('failed');expect(f.calendar.get).not.toHaveBeenCalled();
  });
  it('keeps a confirmed reservation when Telegram rejects, retries once and stops after success',async()=>{
    const f=fixture();f.notify.mockResolvedValueOnce({status:'failed',reason:'http_error',retrySafe:true,provider:'telegram',notificationType:'meeting_booked',timestamp:baseTime} as never);
    const row=await f.service.reserve(f.input);expect(row.status).toBe('confirmed');expect(row.telegram_status).toBe('pending');
    f.tick(180_000);await f.service.recover();await f.service.recover();
    expect((await f.repo.get(f.input.key))?.telegram_status).toBe('sent');expect(f.notify).toHaveBeenCalledTimes(2);expect(f.calendar.create).toHaveBeenCalledOnce();
  });
  it('does not resend an ambiguous Telegram delivery',async()=>{
    const f=fixture();f.notify.mockResolvedValueOnce({status:'failed',reason:'timeout',provider:'telegram',notificationType:'meeting_booked',timestamp:baseTime} as never);
    const row=await f.service.reserve(f.input);expect(row.status).toBe('confirmed');expect(row.telegram_status).toBe('uncertain');
    f.tick(86400000);await f.service.recover();expect(f.notify).toHaveBeenCalledOnce();
  });
  it('enforces persistent rate limits atomically',async()=>{
    const f=fixture();const results=await Promise.allSettled(Array.from({length:8},()=>f.repo.rate('test',3,'2027-01-01T00:00:00Z')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
  });
});
describe('provider adapter, validation and privacy',()=>{
  it('validates international phones without defaulting to Spain',()=>{
    expect(normalizePhone('+1 202 555 0123')).toBe('+12025550123');expect(normalizePhone('0044 20 7946 0018')).toBe('+442079460018');
    expect(normalizePhone('612345678')).toBeNull();expect(normalizePhone('+999123456')).toBeNull();
    const f=fixture();expect(bookingSchema.safeParse(f.input).success).toBe(true);
    for(const change of [{privacy:false},{email:'invalid'},{name:'X'},{website:'spam'},{comment:'x'.repeat(601)},{token:'short'}])expect(bookingSchema.safeParse({...f.input,...change}).success).toBe(false);
  });
  it('escapes user text in Telegram and encodes the manual WhatsApp link',async()=>{
    const f=fixture();const row=await f.service.reserve({...f.input,name:'<script>TEST</script>',business:'A & B'});
    const msg=meetingMessage(row,'');expect(msg.text).not.toContain('<script>');expect(msg.text).toContain('&lt;script&gt;');expect(msg.text).toContain('A &amp; B');expect(msg.whatsapp).toContain('Somos el equipo');
    expect(new URL(msg.url).searchParams.get('text')).toBe(msg.whatsapp);expect(new URL(msg.url).pathname).toBe('/34612345678');
  });
  it('never accepts fake or hostile Meet links',()=>{
    expect(meetLink({id:'test',conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com.evil.test/abc-defg-hij'}]}})).toBeNull();
  });
  it('fails closed when any Google calendar reports an availability error',async()=>{
    const request=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic'}))).mockResolvedValueOnce(new Response(JSON.stringify({calendars:{test:{errors:[{reason:'notFound'}]}}})));
    const google=new GoogleCalendar({calendarId:'test',busyCalendars:[]} as never,request);
    await expect(google.busy(baseTime,'2026-11-01T00:00:00Z')).rejects.toBeInstanceOf(GoogleError);
  });
  it('uses deterministic event and conference IDs and invites only after Meet exists',async()=>{
    const request=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:'synthetic'}))).mockResolvedValueOnce(new Response(JSON.stringify({id:'a123'})));
    const f=fixture();const row=await f.service.reserve(f.input);
    const google=new GoogleCalendar({calendarId:'test',busyCalendars:[]} as never,request);await google.create(row);
    const call=request.mock.calls[1];expect(call[0]).toContain('conferenceDataVersion=1&sendUpdates=none');
    const body=JSON.parse(call[1].body);expect(body.id).toBe(row.event_id);expect(body.conferenceData.createRequest.requestId).toBe(row.event_id);expect(body.attendees).toBeUndefined();
  });
  it('rejects cross-origin posts, large payloads and unauthenticated recovery',async()=>{
    await expect(readBody(new Request('https://example.test/api',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}))).rejects.toMatchObject({status:403});
    await expect(readBody(new Request('https://example.test/api',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'x'.repeat(8001)}))).rejects.toMatchObject({status:413});
    vi.stubEnv('CRON_SECRET','c'.repeat(64));expect(validCron(new Request('https://example.test'))).toBe(false);expect(validCron(new Request('https://example.test',{headers:{Authorization:`Bearer ${'c'.repeat(64)}`}}))).toBe(true);
  });
});
