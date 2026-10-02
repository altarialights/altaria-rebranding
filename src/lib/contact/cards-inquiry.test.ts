import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configured: true, fail: false, rows: new Map<string, { id: string; huella_solicitud: string }>(), calls: [] as unknown[][] }));
vi.mock('../db/client', () => ({
  hasTursoConfiguration: () => state.configured,
  getDatabase: () => ({
    transactionAsync: (fn: (tx: unknown) => Promise<unknown>) => ({ immediate: () => fn({
      get: async (_sql: string,key: string) => state.rows.get(key),
      run: async (sql: string,...args: unknown[]) => { if(state.fail)throw new Error('test failure');state.calls.push([sql,...args]);if(!state.rows.has(String(args[1])))state.rows.set(String(args[1]),{id:String(args[0]),huella_solicitud:String(args[2])}); },
    }) }),
    run: async (sql: string, ...args: unknown[]) => {
      if (state.fail) throw new Error('test failure');
      state.calls.push([sql, ...args]);
      if (!state.rows.has(String(args[1]))) state.rows.set(String(args[1]), { id: String(args[0]), huella_solicitud: String(args[2]) });
    },
    get: async (_sql: string, key: string) => state.rows.get(key),
  }),
}));
import { POST } from '../../pages/api/tarjetas/consulta';

const input = {
  claveIdempotencia: '17a9d45d-72a6-4f35-a7b8-145f901b0123', productoId: 'whatsapp',
  nombre: 'Persona QA', contacto: 'qa@example.com', idea: 'Quiero una tarjeta con mi WhatsApp.',
  configuracion: { destino: 'https://wa.me/34600000000', notas: 'Diseño a consultar' },
  privacidad: true, website: '', startedAt: Date.now() - 5000,
};
const invoke = (body: unknown, origin = 'https://altarialights.com') => Promise.resolve(POST!({ request: new Request('https://altarialights.com/api/tarjetas/consulta', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
}) } as Parameters<NonNullable<typeof POST>>[0]));

describe('card inquiries: endpoint and parameterized persistence with a test double', () => {
  beforeEach(() => { state.rows.clear(); state.calls = []; state.configured = true; state.fail = false; });
  it('stores selection and preparation details without requiring business or quantity, then deduplicates retries', async () => {
    const first = await invoke(input); const body = await first.json();
    expect(first.status).toBe(201); expect(body.saved).toBe(true);
    expect(await (await invoke(input)).json()).toEqual(body);
    expect(state.rows.size).toBe(1);
    const [sql, ...args] = state.calls[0];
    expect(sql).not.toContain(input.nombre); expect(args).toContain(input.nombre);
    expect(args).toContain('whatsapp'); expect(args).toContain(JSON.stringify(input.configuracion));
  });
  it('rejects key reuse with changed data', async () => {
    await invoke(input);
    expect((await invoke({ ...input, idea: 'Una idea completamente diferente' })).status).toBe(409);
    expect(state.rows.size).toBe(1);
  });
  it('persists the complete guided configuration as JSON and deduplicates a retry', async () => {
    const tarjeta = { version: 2, design: 'custom', destination: 'create', artwork: 'not-required', contactPhone: '+34600000000', details: {
      project: 'Crear una carta digital para nuestro restaurante', colors: 'Azul', text: 'Nuestra carta', style: 'Sencillo', instructions: 'Usar nuestra marca',
    } };
    const request = { ...input, productoId: 'cartas-digitales', negocio: 'Restaurante QA', cantidad: 17, configuracion: { tarjeta } };
    const response = await invoke(request);
    expect(response.status).toBe(201);
    expect((await (await invoke(request)).json()).saved).toBe(true);
    expect(state.rows.size).toBe(1);
    const stored = state.calls[0].find(value => typeof value === 'string' && value.startsWith('{"tarjeta":'));
    expect(JSON.parse(String(stored))).toEqual({ tarjeta });
  });
  it('rejects incomplete guided data before writing', async () => {
    const request = { ...input, configuracion: { tarjeta: { version: 2, design: 'own', destination: 'help', artwork: 'requested-later', details: {} } } };
    expect((await invoke(request)).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it.each([{ privacidad: false }, { website: 'spam' }, { contacto: 'incorrecto' }, { idea: 'corta' }, { productoId: 'inventado' }, { cantidad: 0 }])('rejects invalid inquiry %j', async (change) => {
    expect((await invoke({ ...input, ...change })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it('accepts a phone as the sole contact channel', async () => {
    expect((await invoke({ ...input, contacto: '600 000 000' })).status).toBe(201);
  });
  it('returns truthful unavailable and write failure states', async () => {
    state.configured = false; expect((await invoke(input)).status).toBe(503);
    state.configured = true; state.fail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await invoke(input)).status).toBe(500); log.mockRestore();
    expect(state.rows.size).toBe(0);
  });
  it('rejects cross-origin submission and oversized bodies', async () => {
    expect((await invoke(input, 'https://attacker.example')).status).toBe(403);
    expect((await invoke({ ...input, idea: 'x'.repeat(21_000) })).status).toBe(413);
    expect(state.calls).toHaveLength(0);
  });
});
