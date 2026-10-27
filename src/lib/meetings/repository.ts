import { createHash, randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import type { BookingInput } from './validation';
import type { Schedule } from './config';
import type { Slot } from './schedule';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export class MeetingError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export interface Booking {
  id: string; idempotency_key: string; access_hash: string; request_hash: string;
  name: string; business: string; email: string; phone: string; comment: string;
  starts_at: string; ends_at: string; blocked_until: string; timezone: string;
  status: 'pending' | 'confirmed' | 'cancelling' | 'failed';
  calendar_id: string; event_id: string; event_attempted: number;
  meet_status: 'pending' | 'ready' | 'failed'; meet_url: string | null;
  deadline_at: string; next_attempt_at: string; attempts: number;
  lease_token: string | null; lease_until: string | null; last_error: string | null;
  telegram_status: 'pending' | 'sending' | 'sent' | 'uncertain';
  telegram_attempts: number; telegram_message_id: number | null;
  created_at: string; updated_at: string;
  calendar_url: string | null; cancel_requested_at: string | null; cancelled_at: string | null; telegram_edit_pending: number;
}
type Patch = Partial<Pick<Booking, 'status' | 'event_attempted' | 'meet_status' | 'meet_url' | 'next_attempt_at' | 'last_error' | 'telegram_status' | 'telegram_attempts' | 'telegram_message_id' | 'calendar_url' | 'cancel_requested_at' | 'cancelled_at' | 'telegram_edit_pending' | 'starts_at' | 'ends_at' | 'blocked_until'>> & { telegram_sent_at?: string };
const patchKeys = new Set(['status','event_attempted','meet_status','meet_url','next_attempt_at','last_error','telegram_status','telegram_attempts','telegram_message_id','telegram_sent_at']);
for (const key of ['calendar_url','cancel_requested_at','cancelled_at','telegram_edit_pending','starts_at','ends_at','blocked_until']) patchKeys.add(key);
export const fingerprint = (input: BookingInput) => sha256(JSON.stringify([input.start,input.name,input.business,input.email,input.phone,input.comment]));

export class BookingRepository {
  constructor(public db: Pick<Connection, 'get' | 'all' | 'run'>) {}
  async confirmed(now: Date) {
    return await this.db.all("SELECT * FROM meeting_bookings WHERE status = 'confirmed' AND ends_at >= ? ORDER BY starts_at",now.toISOString()) as Booking[];
  }
  async claimManagement(id: string, now: Date): Promise<Booking | null> {
    return await this.db.get(`UPDATE meeting_bookings SET lease_token = ?, lease_until = ?
      WHERE id = ? AND (lease_until IS NULL OR lease_until < ?) AND (status = 'confirmed' OR telegram_edit_pending = 1) RETURNING *`,
      [randomUUID(),new Date(now.getTime()+120000).toISOString(),id,now.toISOString()]) as Booking || null;
  }
  async get(key: string): Promise<Booking | null> {
    return (await this.db.get('SELECT * FROM meeting_bookings WHERE idempotency_key = ?', key)) as Booking || null;
  }
  async byId(id: string): Promise<Booking> {
    return await this.db.get('SELECT * FROM meeting_bookings WHERE id = ?', id) as Booking;
  }
  async active(from: string, to: string) {
    return await this.db.all("SELECT starts_at AS start, blocked_until AS end FROM meeting_bookings WHERE status != 'failed' AND starts_at < ? AND blocked_until > ?", [to, from]) as { start: string; end: string }[];
  }
  async create(input: BookingInput, slot: Slot, config: Schedule, calendarId: string, now: Date): Promise<Booking> {
    const id = randomUUID(); const timestamp = now.toISOString();
    try {
      await this.db.run(`INSERT INTO meeting_bookings
        (id,idempotency_key,access_hash,request_hash,name,business,email,phone,comment,privacy_at,
        starts_at,ends_at,blocked_until,timezone,status,calendar_id,event_id,deadline_at,next_attempt_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`, [
        id,input.key,sha256(input.token),fingerprint(input),input.name,input.business,input.email,input.phone,input.comment,timestamp,
        slot.start,slot.end,new Date(Date.parse(slot.end)+config.bufferMinutes*60_000).toISOString(),config.timezone,
        calendarId,`a${sha256(id)}`,new Date(now.getTime()+15*60_000).toISOString(),timestamp,timestamp,timestamp,
      ]);
    } catch (error) {
      const existing = await this.get(input.key);
      if (existing) { this.authorize(existing, input.token, fingerprint(input)); return existing; }
      if (String(error).includes('meeting_slot_conflict')) throw new MeetingError('slot_taken',409);
      throw error;
    }
    return (await this.get(input.key))!;
  }
  authorize(row: Booking, token: string, hash?: string) {
    if (row.access_hash !== sha256(token)) throw new MeetingError('not_found',404);
    if (hash && row.request_hash !== hash) throw new MeetingError('request_changed',409);
  }
  async claim(id: string, now: Date): Promise<Booking | null> {
    return await this.db.get(`UPDATE meeting_bookings SET lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND (lease_until IS NULL OR lease_until < ?) AND next_attempt_at <= ?
      AND (status IN ('pending','cancelling') OR cancel_requested_at IS NOT NULL OR telegram_edit_pending = 1 OR (status = 'confirmed' AND telegram_status IN ('pending','sending')))
      RETURNING *`, [randomUUID(),new Date(now.getTime()+120_000).toISOString(),now.toISOString(),id,now.toISOString(),now.toISOString()]) as Booking || null;
  }
  async update(row: Booking, patch: Patch): Promise<Booking> {
    const entries = Object.entries(patch);
    if (entries.some(([key]) => !patchKeys.has(key))) throw new Error('invalid_patch');
    const updated = await this.db.get(`UPDATE meeting_bookings SET ${entries.map(([key])=>`${key} = ?`).join(',')}, updated_at = ?
      WHERE id = ? AND lease_token = ? RETURNING *`, [...entries.map(([,v])=>v),new Date().toISOString(),row.id,row.lease_token]);
    if (!updated) throw new MeetingError('lease_lost');
    return updated as Booking;
  }
  async release(row: Booking) {
    await this.db.run('UPDATE meeting_bookings SET lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?', [row.id,row.lease_token]);
  }
  async due(now: Date, limit = 8): Promise<Booking[]> {
    return await this.db.all(`SELECT * FROM meeting_bookings WHERE next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?)
      AND (status IN ('pending','cancelling') OR cancel_requested_at IS NOT NULL OR telegram_edit_pending = 1 OR (status = 'confirmed' AND telegram_status IN ('pending','sending')))
      ORDER BY next_attempt_at LIMIT ?`, [now.toISOString(),now.toISOString(),limit]) as Booking[];
  }
  async rate(bucket: string, limit: number, expires: string) {
    const row = await this.db.get(`INSERT INTO meeting_rate_limits(bucket,hits,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits`, [bucket,expires,limit]);
    if (!row) throw new MeetingError('rate_limited',429);
  }
}
