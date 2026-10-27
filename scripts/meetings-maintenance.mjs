// Authenticated operator CLI; no public admin interface. Defaults to isolated TEST.
import { connect } from '@tursodatabase/serverless';
import { assertTestDatabase,assertRemoteTestMarker,readProjectEnv } from './lib/test-isolation.mjs';
const production=process.argv.includes('--production');
const env=readProjectEnv(production?'.env':'.env.test');if(!env)throw new Error('Falta el archivo de entorno.');
if(production){
  const expected=process.argv.find(v=>v.startsWith('--expected-url='))?.slice(15);
  if(expected!==env.TURSO_DATABASE_URL)throw new Error('Producción requiere --expected-url con el destino exacto.');
}else assertTestDatabase({targetUrl:env.TURSO_DATABASE_URL,token:env.TURSO_AUTH_TOKEN,approvedUrl:env.ALTARIA_TEST_TURSO_URL,productionEnv:readProjectEnv('.env')});
const db=connect({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN});
if(!production)await assertRemoteTestMarker(db,env.ALTARIA_TEST_DB_MARKER);
const id=process.argv.find(v=>v.startsWith('--booking='))?.slice(10);
if(!id){
  console.log(await db.all(`SELECT id,status,meet_status,telegram_status,attempts,telegram_attempts,last_error,next_attempt_at
    FROM meeting_bookings WHERE status IN ('pending','cancelling') OR telegram_status = 'uncertain' ORDER BY created_at LIMIT 100`));
}else{
  const message=process.argv.find(v=>v.startsWith('--delivered-message-id='))?.slice(23);
  if(message && /^\d+$/.test(message)){
    const result=await db.get(`UPDATE meeting_bookings SET telegram_status='sent',telegram_message_id=?,telegram_sent_at=?,updated_at=?,last_error=NULL
      WHERE id=? AND status='confirmed' AND telegram_status='uncertain' AND (lease_until IS NULL OR lease_until<?) RETURNING id`,[Number(message),new Date().toISOString(),new Date().toISOString(),id,new Date().toISOString()]);
    if(!result)throw new Error('No hay entrega incierta conciliable para esa referencia.');console.log('Entrega conciliada. No se ha enviado nada.');
  }else if(process.argv.includes('--retry-confirmed-absent')){
    const result=await db.get(`UPDATE meeting_bookings SET telegram_status='pending',next_attempt_at=?,updated_at=?,last_error=NULL
      WHERE id=? AND status='confirmed' AND telegram_status='uncertain' AND (lease_until IS NULL OR lease_until<?) RETURNING id`,[new Date().toISOString(),new Date().toISOString(),id,new Date().toISOString()]);
    if(!result)throw new Error('No hay entrega incierta conciliable para esa referencia.');console.log('Reintento encolado después de la revisión manual del chat.');
  }else if(process.argv.includes('--refresh-message')){
    const result=await db.get(`UPDATE meeting_bookings SET telegram_edit_pending=1,next_attempt_at=?
      WHERE id=? AND telegram_status='sent' AND telegram_message_id IS NOT NULL AND (lease_until IS NULL OR lease_until<?) RETURNING id`,[new Date().toISOString(),id,new Date().toISOString()]);
    if(!result)throw new Error('No hay aviso entregado disponible para actualizar.');
    console.log('Edición del aviso existente encolada. No se crea otro mensaje.');
  }else throw new Error('Usa --refresh-message o revisa el chat antes de conciliar una entrega incierta.');
}
