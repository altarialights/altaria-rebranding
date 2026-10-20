// Destructive-looking checks are confined to one TEST transaction, then deliberately rolled back.
// All inserted names, identities and source records are synthetic.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from '@tursodatabase/serverless';
import { assertRemoteTestMarker, assertStagingWorkOS, assertTestDatabase,
  assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en entorno local.');
}
const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: prod });
const payload = JSON.parse(Buffer.from(test.TURSO_AUTH_TOKEN.split('.')[1] ?? '', 'base64url').toString());
if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new Error('Token TEST caducado.');
const db = connect({ url: test.TURSO_DATABASE_URL, authToken: test.TURSO_AUTH_TOKEN });
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
const name = '008_altaria_os_crm.sql';
const hash = createHash('sha256').update(readFileSync(new URL(`../migrations/${name}`, import.meta.url))).digest('hex');
const migration = await db.get('SELECT sha256 FROM altaria_schema_migrations WHERE name = ?', [name]);
assert.equal(migration?.sha256, hash, 'Migración 008 aplicada y sin cambios');
const fk = await db.get('PRAGMA foreign_keys');
assert.equal(Number(fk?.foreign_keys), 1, 'Las FK deben estar activas en la conexión TEST');

const tables = ['altaria_admin_users', 'crm_organizations', 'crm_contacts', 'crm_opportunities',
  'crm_activities', 'crm_tasks', 'crm_source_links', 'crm_timeline_events',
  'digital_assessments', 'digital_leads', 'consultas_tarjetas', 'pedidos_tarjetas'];
async function counts() {
  const out = {};
  for (const table of tables) out[table] = Number((await db.get(`SELECT count(*) AS n FROM ${table}`)).n);
  return out;
}
const before = await counts();
const nonSyntheticUsers = await db.get(`SELECT count(*) AS n FROM altaria_admin_users
  WHERE workos_user_id NOT LIKE 'user_synthetic_%'`);
assert.equal(Number(nonSyntheticUsers?.n), 1, 'Debe existir un solo propietario TEST no sintético');
const liveOrders = await db.get(`SELECT count(*) AS n FROM pedidos_tarjetas WHERE stripe_entorno!='test'`);
assert.equal(Number(liveOrders?.n), 0, 'El fixture TEST no debe contener pedidos live');
const marker = new Error('ROLLBACK_SYNTHETIC_CRM_TEST');
let rejected = 0;
try {
  await db.transactionAsync(async (tx) => {
    const at = new Date().toISOString();
    const user = randomUUID(), org = randomUUID(), otherOrg = randomUUID(), contact = randomUUID();
    const opp = randomUUID(), activity = randomUUID(), task = randomUUID();
    const assessment = randomUUID(), lead = randomUUID(), inquiry = randomUUID(), order = randomUUID();
    const run = (sql, args) => tx.run(sql, args);
    const mustReject = async (sql, args) => {
      try { await run(sql, args); } catch { rejected += 1; return; }
      throw new Error('Una restricción TEST aceptó una escritura inválida.');
    };
    await run(`INSERT INTO altaria_admin_users
      (id,email,workos_user_id,display_name,status,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?)`, [user, 'synthetic.crm@example.test', `user_synthetic_${user}`, 'Persona sintética', at, at]);
    await run('INSERT INTO altaria_admin_user_roles (user_id,role_key,granted_at) VALUES (?,?,?)', [user, 'sales', at]);
    for (const [id, name] of [[org, 'Empresa Sintética Uno'], [otherOrg, 'Empresa Sintética Dos']]) {
      await run(`INSERT INTO crm_organizations
        (id,name,normalized_name,country_code,responsible_user_id,created_at,updated_at)
        VALUES (?,?,?,'ES',?,?,?)`, [id, name, name.toLowerCase(), user, at, at]);
    }
    await run(`INSERT INTO crm_organization_identifiers
      (id,organization_id,kind,normalized_value,verification_status,verified_at,verified_by,created_at)
      VALUES (?,?,'domain','synthetic.example.test','verified',?,?,?)`, [randomUUID(), org, at, user, at]);
    await mustReject(`INSERT INTO crm_organization_identifiers
      (id,organization_id,kind,normalized_value,verification_status,verified_at,verified_by,created_at)
      VALUES (?,?,'domain','synthetic.example.test','verified',?,?,?)`, [randomUUID(), otherOrg, at, user, at]);
    await run(`INSERT INTO crm_contacts
      (id,organization_id,full_name,email,is_primary,created_at,updated_at)
      VALUES (?,?,'Contacto Sintético','contacto@example.test',1,?,?)`, [contact, org, at, at]);
    await mustReject(`INSERT INTO crm_contacts
      (id,organization_id,full_name,is_primary,created_at,updated_at)
      VALUES (?,?,'Otro contacto',1,?,?)`, [randomUUID(), org, at, at]);
    await run(`INSERT INTO crm_opportunities
      (id,organization_id,title,stage,amount_cents,responsible_user_id,created_at,updated_at)
      VALUES (?,?,'Proyecto sintético','new',1234,?,?,?)`, [opp, org, user, at, at]);
    await mustReject(`UPDATE crm_opportunities SET stage = 'won' WHERE id = ?`, [opp]);
    await run(`INSERT INTO crm_activities
      (id,organization_id,opportunity_id,contact_id,kind,summary,happened_at,actor_user_id,created_at)
      VALUES (?,?,?,?,'call','Llamada sintética',?,?,?)`, [activity, org, opp, contact, at, user, at]);
    await mustReject(`INSERT INTO crm_activities
      (id,organization_id,opportunity_id,kind,summary,happened_at,actor_user_id,created_at)
      VALUES (?,?,?,'note','Relación cruzada',?,?,?)`, [randomUUID(), otherOrg, opp, at, user, at]);
    await run(`INSERT INTO crm_tasks
      (id,organization_id,opportunity_id,contact_id,origin_activity_id,title,responsible_user_id,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,'Seguimiento sintético',?,?,?,?)`, [task, org, opp, contact, activity, user, user, at, at]);
    await run(`INSERT INTO digital_assessments
      (id,questionnaire_version,result_token_hash,overall_score,maturity_level,primary_opportunity,created_at)
      VALUES (?,'synthetic-v1',?,50,'FRAGMENTED_DIGITIZATION','presence',?)`, [assessment, randomUUID(), at]);
    await run(`INSERT INTO digital_leads
      (id,assessment_id,full_name,email,job_title,company_name,company_url,company_size,
       privacy_consent_at,commercial_score,commercial_priority,created_at)
      VALUES (?,?,'Lead sintético','lead@example.test','Prueba','Empresa Sintética Uno',
       'https://example.test','1',?,50,'MEDIUM',?)`, [lead, assessment, at, at]);
    await run(`INSERT INTO consultas_tarjetas
      (id,clave_idempotencia,huella_solicitud,producto_id,nombre,contacto,idea,privacidad_aceptada_en,creado_en)
      VALUES (?,?,?,'synthetic-product','Consulta sintética','consulta@example.test','Prueba',?,?)`,
      [inquiry, randomUUID(), randomUUID(), at, at]);
    await run(`INSERT INTO pedidos_tarjetas
      (id,numero_pedido,clave_idempotencia,huella_solicitud,google_place_id,negocio_nombre,
       negocio_direccion,cantidad,precio_unitario_centimos,subtotal_centimos,envio_centimos,
       total_centimos,cliente_nombre,cliente_email,cliente_telefono,envio_direccion,
       envio_codigo_postal,envio_ciudad,envio_provincia,creado_en,stripe_entorno)
      VALUES (?,?,?,?,?,?,?,1,100,100,0,100,?,?,?,?,?,?,?,?,'test')`,
      [order, `TEST-${randomUUID()}`, randomUUID(), randomUUID(), `place_synthetic_${order}`,
        'Empresa Sintética Uno', 'Calle de prueba', 'Cliente sintético', 'cliente@example.test',
        '600000000', 'Calle de prueba', '28000', 'Madrid', 'Madrid', at]);
    for (const [column, sourceId] of [['digital_lead_id', lead], ['card_inquiry_id', inquiry], ['card_order_id', order]]) {
      await run(`INSERT INTO crm_source_links (id,organization_id,${column},linked_by,linked_at)
        VALUES (?,?,?,?,?)`, [randomUUID(), org, sourceId, user, at]);
    }
    await mustReject(`INSERT INTO crm_source_links (id,organization_id,digital_lead_id,linked_by,linked_at)
      VALUES (?,?,?,?,?)`, [randomUUID(), otherOrg, lead, user, at]);
    await run(`INSERT INTO crm_timeline_events
      (id,organization_id,event_type,entity_id,actor_user_id,occurred_at,details_json)
      VALUES (?,?,'activity.created',?,?,?,'{}')`, [randomUUID(), org, activity, user, at]);
    const links = await tx.get('SELECT count(*) AS n FROM crm_source_links WHERE organization_id = ?', [org]);
    assert.equal(Number(links?.n), 3);
    throw marker;
  }).immediate();
} catch (error) {
  if (error !== marker) throw error;
}
await assertRemoteTestMarker(db, test.ALTARIA_TEST_DB_MARKER);
assert.deepEqual(await counts(), before, 'El rollback debe dejar TEST exactamente como estaba');
const fkProblems = await db.all('PRAGMA foreign_key_check');
assert.equal(fkProblems.length, 0);
assert.equal(rejected, 5);
console.log('CRM TEST: 3 fuentes sintéticas vinculadas, 5 restricciones comprobadas, rollback completo y marcador intacto.');
