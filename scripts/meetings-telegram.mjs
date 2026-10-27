// Local polling or explicit production webhook registration for the dedicated meeting bot.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const path = '.env.bookings.local';
const env = parseEnv(readFileSync(path,'utf8'));
const production = process.argv.includes('--set-production-webhook');
const token = production ? env.BOOKING_TELEGRAM_BOT_TOKEN : env.BOOKING_TEST_TELEGRAM_BOT_TOKEN;
const chat = production ? env.BOOKING_TELEGRAM_CHAT_ID : env.BOOKING_TEST_TELEGRAM_CHAT_ID;
if (!token || !chat) throw new Error('Falta el bot o chat de reuniones del entorno elegido.');
async function api(method,body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const data = await res.json(); if (!data.ok) throw new Error(`Telegram rechazó ${method} (${res.status}).`); return data.result;
}
const webhook = await api('getWebhookInfo');
if (process.argv.includes('--prepare-test-owner')) {
  if (webhook.url) throw new Error('El bot ya tiene webhook. No se cambia automáticamente.');
  const updates = await api('getUpdates',{timeout:0});
  const matches = updates.filter(u => String(u.message?.chat?.id) === chat && u.message?.text === '/prueba@calendario_altaria_bot' && !u.message?.from?.is_bot);
  const ids = [...new Set(matches.map(u => String(u.message.from.id)))];
  if (ids.length !== 1) throw new Error('Envía /prueba@calendario_altaria_bot en el grupo de reuniones para identificar al propietario.');
  if (env.BOOKING_TELEGRAM_OWNER_ID && env.BOOKING_TELEGRAM_OWNER_ID !== ids[0]) throw new Error('El propietario existente no coincide; revisar manualmente.');
  const additions = {BOOKING_TELEGRAM_OWNER_ID:ids[0],BOOKING_TELEGRAM_WEBHOOK_SECRET:env.BOOKING_TELEGRAM_WEBHOOK_SECRET || randomBytes(32).toString('hex')};
  let content = readFileSync(path,'utf8');
  for (const [key,value] of Object.entries(additions)) { content = content.replace(new RegExp(`^${key}=.*(?:\r?\n|$)`,'gm'),''); content += `\n${key}=${value}\n`; }
  writeFileSync(path,content,'utf8'); console.log('Propietario y secreto guardados localmente; no se han mostrado credenciales.');
} else if (production) {
  const target = new URL(process.argv.find(a=>a.startsWith('https://')) || '');
  if (target.pathname !== '/api/reuniones/telegram' || !env.BOOKING_TELEGRAM_OWNER_ID || (env.BOOKING_TELEGRAM_WEBHOOK_SECRET || '').length < 32) throw new Error('Configuración incompleta o URL incorrecta.');
  if (webhook.url && webhook.url !== target.href) throw new Error('Existe otro webhook; no se sustituye automáticamente.');
  await api('setWebhook',{url:target.href,secret_token:env.BOOKING_TELEGRAM_WEBHOOK_SECRET,allowed_updates:['callback_query'],drop_pending_updates:false});
  console.log('Webhook del bot de reuniones registrado.');
} else if (process.argv.includes('--poll-test')) {
  if (webhook.url) throw new Error('El bot tiene webhook activo; polling deshabilitado.');
  const base = new URL(process.argv.find(a=>a.startsWith('http://')) || 'http://127.0.0.1:4323');
  if (base.hostname !== '127.0.0.1' || !env.BOOKING_TELEGRAM_OWNER_ID || (env.BOOKING_TELEGRAM_WEBHOOK_SECRET || '').length < 32) throw new Error('Polling permitido solo con servidor local y configuración completa.');
  console.log('Escuchando botones del bot TEST. Ctrl+C para terminar.');
  let offset;
  while (true) {
    try {
      const updates = await api('getUpdates',{offset,timeout:15,allowed_updates:['callback_query']});
      for (const update of updates) {
        if (update.callback_query) {
          const response = await fetch(new URL('/api/reuniones/telegram',base),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':env.BOOKING_TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(update),signal:AbortSignal.timeout(55000)});
          if (!response.ok) throw new Error('Acción pendiente de reintento.');
        }
        offset = update.update_id+1;
      }
    } catch { console.log('Conexión pendiente; se reintentará sin descartar la acción.'); await new Promise(r=>setTimeout(r,5000)); }
  }
} else console.log('Usa --prepare-test-owner, --poll-test http://127.0.0.1:4323 o --set-production-webhook https://DOMINIO/api/reuniones/telegram');
