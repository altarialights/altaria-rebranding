import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDatabase } from '../db/client';
import { jsonResponse } from '../orders/http';
import { meetingConfig, readSchedule } from './config';
import { BookingRepository, MeetingError } from './repository';
import { GoogleCalendar } from './google';
import { meetingNotifier, editMeetingMessage } from './telegram';
import { MeetingService } from './service';

export function runtime() {
  const config = meetingConfig();
  const repo = new BookingRepository(getDatabase());
  const calendar = new GoogleCalendar(config);
  const edit = (row: import('./repository').Booking) => editMeetingMessage(row,config.organizerName);
  const service = new MeetingService(repo,calendar,meetingNotifier(config.organizerName),readSchedule(),config.calendarId,undefined,edit);
  return {config,repo,service,calendar,edit};
}
export async function rateLimit(repo: BookingRepository, secret: string, identity: string, scope: string, limit: number, minutes: number) {
  const bucketTime = Math.floor(Date.now()/(minutes*60_000));
  const hash = createHmac('sha256',secret).update(`${scope}:${bucketTime}:${identity}`).digest('hex');
  await repo.rate(`${scope}:${hash}`,limit,new Date((bucketTime+2)*minutes*60_000).toISOString());
}
export async function readBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('sec-fetch-site') === 'cross-site') throw new MeetingError('invalid_origin',403);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new MeetingError('invalid_body',415);
  const reader = request.body?.getReader();
  if (!reader) throw new MeetingError('invalid_body',400);
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.length;
    if (size>8000) { await reader.cancel(); throw new MeetingError('invalid_body',413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new MeetingError('invalid_body',400); }
}
const messages: Record<string,string> = {
  slot_taken:'Ese hueco acaba de ocuparse. Elige otra hora.', invalid_slot:'La hora seleccionada ya no está disponible. Actualiza el calendario.',
  request_changed:'Esta solicitud ya existe con otros datos. Recupera su estado antes de reservar otra vez.',
  rate_limited:'Has realizado demasiadas solicitudes. Espera unos minutos antes de volver a intentarlo.',
  not_found:'No encontramos la reserva con esa referencia.', invalid_body:'Revisa los datos del formulario.',
  invalid_origin:'No se ha podido verificar el origen de la solicitud.', test_attendee:'En pruebas solo se permite el correo de prueba configurado.',
};
export function errorResponse(error: unknown) {
  const code = error instanceof MeetingError ? error.code : 'unavailable';
  const response = jsonResponse({error:messages[code] || 'La agenda online no está disponible ahora. Puedes contactar con nosotros por WhatsApp o email.',code},error instanceof MeetingError ? error.status : 503);
  if (code==='rate_limited') response.headers.set('Retry-After','900');
  return response;
}
export const validCron = (request: Request) => {
  const secret = process.env.CRON_SECRET || '';
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length>=32 && actual.length===expected.length && timingSafeEqual(actual,expected);
};
