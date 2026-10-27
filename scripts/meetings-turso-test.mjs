import {connect} from '@tursodatabase/serverless';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertTestDatabase,assertRemoteTestMarker,readProjectEnv} from './lib/test-isolation.mjs';
const env=readProjectEnv('.env.test');if(!env)throw Error('Missing TEST environment');
const host=assertTestDatabase({targetUrl:env.TURSO_DATABASE_URL,token:env.TURSO_AUTH_TOKEN,approvedUrl:env.ALTARIA_TEST_TURSO_URL,productionEnv:readProjectEnv('.env')});
const clients=[connect({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN}),connect({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN})];
await assertRemoteTestMarker(clients[0],env.ALTARIA_TEST_DB_MARKER);
const ids=[randomUUID(),randomUUID()];const bucket=`synthetic-${randomUUID()}`;
const sql=`INSERT INTO meeting_bookings(id,idempotency_key,access_hash,request_hash,name,business,email,phone,privacy_at,
  starts_at,ends_at,blocked_until,timezone,status,calendar_id,event_id,deadline_at,next_attempt_at,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`;
const day=1+Math.floor(Math.random()*27);const start=`2099-12-${String(day).padStart(2,'0')}T09:00:00.000Z`;
const end=start.replace('09:00','09:30');const blocked=start.replace('09:00','09:45');const now=new Date().toISOString();
const values=id=>[id,id,'a'.repeat(64),'b'.repeat(64),'TEST synthetic','TEST no real booking','synthetic@example.test','+12025550123',now,start,end,blocked,'Europe/Madrid','synthetic-never-google',`a${id.replaceAll('-','')}`,now,now,now,now];
try{
  const attempts=await Promise.allSettled(clients.map((db,i)=>db.run(sql,values(ids[i]))));
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1,'Exactly one concurrent booking must commit');
  const failure=attempts.find(a=>a.status==='rejected');assert.match(String(failure.reason),/meeting_slot_conflict/);
  const winner=ids[attempts.findIndex(a=>a.status==='fulfilled')];const loser=ids.find(id=>id!==winner);
  const claims=await Promise.all(clients.map(db=>db.get(`UPDATE meeting_bookings SET lease_token=?,lease_until=?
    WHERE id=? AND (lease_until IS NULL OR lease_until<?) RETURNING id`,[randomUUID(),'2100-01-01T00:00:00.000Z',winner,now])));
  assert.equal(claims.filter(Boolean).length,1,'Only one worker can acquire the lease');
  await assert.rejects(clients[0].run("UPDATE meeting_bookings SET status='confirmed' WHERE id=?",winner),/constraint/i);
  await clients[0].run("UPDATE meeting_bookings SET status='failed' WHERE id=?",winner);
  await clients[1].run(sql,values(loser));
  const rate=await Promise.allSettled(Array.from({length:5},(_,i)=>clients[i%2].get(`INSERT INTO meeting_rate_limits(bucket,hits,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 WHERE hits<2 RETURNING hits`,[bucket,now])));
  assert.equal(rate.filter(r=>r.status==='fulfilled'&&r.value).length,2);
  console.log('PASS: concurrent exclusion, lease exclusion, confirmed/Meet constraint, release and persistent rate limit on Turso TEST:',host);
}finally{
  await clients[0].run('DELETE FROM meeting_bookings WHERE id IN (?,?)',ids);
  await clients[0].run('DELETE FROM meeting_rate_limits WHERE bucket=?',bucket);
  assert.equal(Number((await clients[0].get('SELECT COUNT(*) AS n FROM meeting_bookings WHERE id IN (?,?)',ids)).n),0);
  console.log('Synthetic rows removed. No Calendar/Telegram calls made.');
}
