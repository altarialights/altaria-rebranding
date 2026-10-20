import { describe, expect, it } from 'vitest';
import { canAdvanceStage, canReadOrganization, canWriteOrganization,
  normalizeCompanyName, normalizeIdentifier, opportunitySchema, sourceLinkSchema } from './model';
import type { AdminPrincipal } from '../access';

const principal = (id: string, roles: AdminPrincipal['roles']): AdminPrincipal => ({
  id, roles, email: `${id}@example.test`, displayName: 'Usuario sintético', sessionHash: 'synthetic-session',
});

describe('CRM: permiso por recurso', () => {
  it('permite al comercial únicamente sus empresas y al lector sólo consultar', () => {
    expect(canReadOrganization(principal('sales-1', ['sales']), 'sales-1')).toBe(true);
    expect(canWriteOrganization(principal('sales-1', ['sales']), 'sales-2')).toBe(false);
    expect(canReadOrganization(principal('sales-1', ['sales']), 'sales-2')).toBe(false);
    expect(canReadOrganization(principal('viewer', ['viewer']), 'sales-2')).toBe(true);
    expect(canWriteOrganization(principal('viewer', ['viewer']), 'sales-2')).toBe(false);
    expect(canWriteOrganization(principal('owner', ['owner']), 'sales-2')).toBe(true);
  });
});

describe('CRM: pipeline e identidad de empresa', () => {
  it('sólo permite avanzar una etapa, o cerrar como perdida', () => {
    expect(canAdvanceStage('new', 'contacted')).toBe(true);
    expect(canAdvanceStage('new', 'proposal')).toBe(false);
    expect(canAdvanceStage('new', 'lost')).toBe(true);
    expect(canAdvanceStage('negotiation', 'won')).toBe(true);
    expect(canAdvanceStage('won', 'lost')).toBe(false);
    expect(canAdvanceStage('lost', 'new')).toBe(false);
  });
  it('normaliza señales para encontrar coincidencias sin depender de mayúsculas o acentos', () => {
    expect(normalizeCompanyName('  Café  Álamo, S.L. ')).toBe('cafe alamo s l');
    expect(normalizeIdentifier('domain', 'https://www.Example.test/path')).toBe('example.test');
    expect(normalizeIdentifier('tax_id', 'ES B-123 456')).toBe('esb123456');
  });
  it('valida importes y claves de fuente antes de cualquier escritura', () => {
    const input = { organizationId: '00000000-0000-4000-8000-000000000001', title: 'Proyecto sintético',
      responsibleUserId: '', amountEuros: '12.34' };
    expect(opportunitySchema.parse(input).amountEuros).toBe(1234);
    expect(opportunitySchema.safeParse({ ...input, amountEuros: '-1' }).success).toBe(false);
    expect(sourceLinkSchema.safeParse({ organizationId: input.organizationId,
      sourceKind: 'cards_order', sourceId: '00000000-0000-4000-8000-000000000002' }).success).toBe(true);
    expect(sourceLinkSchema.safeParse({ organizationId: input.organizationId,
      sourceKind: 'production', sourceId: input.organizationId }).success).toBe(false);
  });
});
