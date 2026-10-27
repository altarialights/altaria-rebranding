import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { runtime } from '../../../lib/meetings/http';
import { MeetingError } from '../../../lib/meetings/repository';
import { cancelMeeting, revision, synchronize } from '../../../lib/meetings/management';
import { editMeetingMessage, meetingTelegramEnvironment, telegramCall } from '../../../lib/meetings/telegram';
export const prerender = false;

export const POST: APIRoute = async ({request}) => {
  const secret = process.env.BOOKING_TELEGRAM_WEBHOOK_SECRET || '';
  const actual = Buffer.from(request.headers.get('x-telegram-bot-api-secret-token') || '');
  const expected = Buffer.from(secret);
  if (secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual,expected)) return new Response(null,{status:403});
  const reader = request.body?.getReader();
  if (!reader) return new Response(null,{status:400});
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 16000) { await reader.cancel(); return new Response(null,{status:413}); } chunks.push(value); }
  let update;
  try { update = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return new Response(null,{status:400}); }
  const query = update?.callback_query;
  if (!query) return new Response('ok');
  if (!process.env.BOOKING_TELEGRAM_OWNER_ID || String(query.from?.id) !== process.env.BOOKING_TELEGRAM_OWNER_ID
    || String(query.message?.chat?.id) !== meetingTelegramEnvironment().chatId || query.message?.forward_origin) return new Response('ok');
  const match = /^(ask|del|back):([0-9a-f-]{36}):([0-9a-f]{12})$/.exec(query.data || '');
  if (!match) return new Response('ok');
  let answer = 'No se ha podido completar. Inténtalo de nuevo.';
  try {
    const {repo,calendar,edit,config} = runtime();
    let row = await repo.byId(match[2]);
    if (!row || row.telegram_message_id !== query.message.message_id) return new Response('ok');
    if (row.cancelled_at) { await edit(row); answer = 'La reunión ya está eliminada.'; }
    else if (match[1] === 'del') {
      row = await cancelMeeting(repo,calendar,row,match[3],new Date(),edit);
      answer = row.cancelled_at ? 'Reunión eliminada.' : 'La reunión cambió. Revisa los datos antes de eliminarla.';
    } else {
      row = await synchronize(repo,calendar,row,new Date(),edit);
      const unchanged = !row.cancelled_at && revision(row) === match[3];
      await editMeetingMessage(row,config.organizerName,unchanged && match[1] === 'ask');
      answer = unchanged ? (match[1] === 'ask' ? 'Confirma en el mensaje para eliminar la reunión.' : 'No se ha eliminado la reunión.') : 'La reunión ha cambiado. Revisa el mensaje actualizado.';
    }
  } catch (error) {
    if (error instanceof MeetingError && error.code === 'meeting_changed') {
      answer = 'La reunión ha cambiado. Revisa los datos y pulsa Eliminar de nuevo.';
      return new Response('ok');
    }
    return new Response('retry',{status:503});
  }
  finally { try { await telegramCall('answerCallbackQuery',{callback_query_id:query.id,text:answer}); } catch { /* Callback may already be acknowledged; changes remain durable. */ } }
  return new Response('ok');
};
