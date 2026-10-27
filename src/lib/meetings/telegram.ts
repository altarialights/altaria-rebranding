import { escapeTelegramHtml as escape } from '../notifications/templates';
import { sendTelegramMessage } from '../notifications/telegram.service';
import type { NotificationDeliveryResult, TelegramServiceOptions } from '../notifications/types';
import type { Booking } from './repository';
import { revision } from './management';

export function meetingTelegramEnvironment() {
  const production = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
  return {botToken:production ? process.env.BOOKING_TELEGRAM_BOT_TOKEN : process.env.BOOKING_TEST_TELEGRAM_BOT_TOKEN,
    chatId:production ? process.env.BOOKING_TELEGRAM_CHAT_ID : process.env.BOOKING_TEST_TELEGRAM_CHAT_ID};
}
export function meetingKeyboard(row: Booking): NonNullable<TelegramServiceOptions['inlineKeyboard']> {
  if (row.cancelled_at) return [];
  const buttons: NonNullable<TelegramServiceOptions['inlineKeyboard']> = [[{text:'Abrir WhatsApp con el mensaje',url:meetingMessage(row,'').url}]];
  if (row.calendar_url) {
    try { const url = new URL(row.calendar_url); if (url.protocol === 'https:' && ['calendar.google.com','www.google.com'].includes(url.hostname)) buttons.push([{text:'Modificar reunión',url:url.href}]); } catch { /* Invalid provider link. */ }
  }
  if (process.env.BOOKING_TELEGRAM_OWNER_ID && (process.env.BOOKING_TELEGRAM_WEBHOOK_SECRET || '').length >= 32) buttons.push([{text:'Eliminar reunión',callback_data:`ask:${row.id}:${revision(row)}`}]);
  return buttons;
}

export async function telegramCall(method: 'editMessageText' | 'answerCallbackQuery', body: object) {
  const {botToken} = meetingTelegramEnvironment();
  if (!botToken) throw new Error('telegram_unconfigured');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const data = await response.json();
  if (!data.ok && !(method === 'editMessageText' && data.description?.includes('message is not modified'))) throw new Error('telegram_edit_failed');
}

export async function editMeetingMessage(row: Booking, organizer: string, confirm = false) {
  const message = meetingMessage(row,organizer);
  const keyboard = meetingKeyboard(row);
  if (keyboard[0]?.[0] && 'url' in keyboard[0][0]) keyboard[0][0].url = message.url;
  await telegramCall('editMessageText',{chat_id:meetingTelegramEnvironment().chatId,message_id:row.telegram_message_id,
    text:row.cancelled_at ? `<b>Reunión eliminada</b>\n${escape(row.name)} · ${escape(row.business)}\nReserva: ${escape(row.id)}\nLa cita se ha cancelado en Google Calendar y el hueco está libre.` : message.text+(confirm ? '\n\n<b>¿Eliminar esta reunión?</b> Se cancelará en Google Calendar y se avisará al invitado.' : ''),
    parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:confirm ? [
      [{text:'Sí, eliminar reunión',callback_data:`del:${row.id}:${revision(row)}`}],
      [{text:'Volver sin eliminar',callback_data:`back:${row.id}:${revision(row)}`}],
    ] : keyboard}});
}

export function meetingMessage(row: Booking, organizer: string) {
  const date = new Intl.DateTimeFormat('es-ES',{timeZone:row.timezone,dateStyle:'full'}).format(new Date(row.starts_at));
  const time = new Intl.DateTimeFormat('es-ES',{timeZone:row.timezone,timeStyle:'short'}).format(new Date(row.starts_at));
  const introduction = organizer ? `Soy ${organizer} de Altaria Lights` : 'Somos el equipo de Altaria Lights';
  const whatsapp = `Hola, ${row.name}. ${introduction}. Has reservado una reunión con nosotros para el ${date} a las ${time} (${row.timezone}).\n\n¿Me confirmas que podrás asistir?\n\nNos vemos por Google Meet: ${row.meet_url}\n\nSi necesitas cambiar la cita, avísame. ¡Gracias!`;
  const url = `https://wa.me/${row.phone.replace(/^\+/,'')}?text=${encodeURIComponent(whatsapp)}`;
  const duration = (Date.parse(row.ends_at)-Date.parse(row.starts_at))/60_000;
  const text = `<b>Nueva reunión reservada</b>\n${escape(row.name)} · ${escape(row.business)}\n${escape(row.email)}\n${escape(row.phone)}\n${escape(row.comment || 'Sin comentario')}\n\n${escape(date)} · ${escape(time)} · ${duration} min\nZona: ${escape(row.timezone)}\nMeet: ${escape(row.meet_url || '')}\nReserva: ${escape(row.id)}\n\n<b>Mensaje para WhatsApp</b>\n${escape(whatsapp)}`;
  return {text,whatsapp,url};
}
export type MeetingNotifier = (row: Booking) => Promise<NotificationDeliveryResult>;
export const meetingNotifier = (organizer: string): MeetingNotifier => async row => {
  const message = meetingMessage(row,organizer);
  const keyboard = meetingKeyboard(row);
  if (keyboard[0]?.[0] && 'url' in keyboard[0][0]) keyboard[0][0].url = message.url;
  return sendTelegramMessage(message.text,{
    notificationType:'meeting_booked',inlineKeyboard:keyboard,environment:meetingTelegramEnvironment(),
  });
};
