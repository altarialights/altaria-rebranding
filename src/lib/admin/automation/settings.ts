import { randomUUID } from 'node:crypto';
import type { Connection } from '@tursodatabase/serverless';
import { getDatabase } from '../../db/client';
import type { AdminPrincipal } from '../access';
import { assertCardsTest } from '../cards/service';
import { WorkError } from './work';

export async function automationHealth(principal:AdminPrincipal,db:Connection=getDatabase()) {
  if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
  await assertCardsTest(db);
  const [rules,queue,notifications,history]=await Promise.all([
    db.all('SELECT rule_key,enabled,local_time,updated_at FROM os_rule_config ORDER BY rule_key'),
    db.all('SELECT status,count(*) AS n FROM os_jobs GROUP BY status'),
    db.all('SELECT status,count(*) AS n FROM os_notifications GROUP BY status'),
    db.all(`SELECT j.id,j.rule_key,j.status,j.attempts,j.last_error_code,j.updated_at
      FROM os_jobs j ORDER BY j.updated_at DESC LIMIT 25`),
  ]);
  return {rules,queue,notifications,history};
}

export async function setRuleConfig(principal:AdminPrincipal,key:string,enabled:boolean,
  localTime:string|null,db:Connection=getDatabase()) {
  if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
  if(!/^[a-z]+(?:\.[a-z]+)+$/.test(key)||localTime&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)
    ||key!=='daily.brief')) throw new WorkError('invalid_rule');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const row=await tx.get('SELECT rule_key,local_time FROM os_rule_config WHERE rule_key=?',[key]);
    if(!row) throw new WorkError('rule_missing',404);
    const at=new Date().toISOString();
    await tx.batch([{sql:`UPDATE os_rule_config SET enabled=?,local_time=?,updated_at=?,updated_by=?
      WHERE rule_key=?`,args:[enabled?1:0,key==='daily.brief'?localTime:row.local_time,at,
        principal.id,key]},
      {sql:`INSERT INTO altaria_admin_audit_events
        (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
        VALUES (?,?,?,?,?,'automation_rule',?,'success','{}')`,
      args:[randomUUID(),at,principal.id,principal.sessionHash,'os.rule.configure',key]}]);
  }).immediate();
}

export async function retryDeadJob(principal:AdminPrincipal,id:string,db:Connection=getDatabase()) {
  if(!principal.roles.includes('owner')) throw new WorkError('forbidden',403);
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new WorkError('invalid_id');
  await assertCardsTest(db);
  return db.transactionAsync(async tx=>{
    const at=new Date().toISOString();
    const result=await tx.run(`UPDATE os_jobs SET status='queued',attempts=0,run_at=?,
      last_error_code=NULL,updated_at=? WHERE id=? AND status='dead'`,[at,at,id]);
    if(Number(result.changes)!==1) throw new WorkError('job_not_dead',409);
    await tx.run(`INSERT INTO altaria_admin_audit_events
      (id,occurred_at,actor_user_id,actor_session_hash,action,target_type,target_id,outcome,details_json)
      VALUES (?,?,?,?,?,'automation_job',?,'success','{}')`,
      [randomUUID(),at,principal.id,principal.sessionHash,'os.job.retry',id]);
  }).immediate();
}
