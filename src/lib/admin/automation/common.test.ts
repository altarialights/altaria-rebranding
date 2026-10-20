import { describe,expect,it } from 'vitest';
import { approvalDigest,madridDay,madridTime,retryDelayMs,workItemVersion } from './common';
import { renderTelegram,simulatedTelegram } from './telegram';
import { localTestLink,testQrPreview } from '../cards/local-link';

describe('Fase 6, reglas puras y salidas seguras',()=>{
  it('usa Europe/Madrid incluso en los cambios de horario',()=>{
    expect(madridDay(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
    expect(madridTime(new Date('2026-03-29T00:30:00Z'))).toBe('01:30');
    expect(madridTime(new Date('2026-03-29T01:30:00Z'))).toBe('03:30');
    expect(madridDay(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
  });
  it('limita el backoff y vincula aprobación al contenido exacto',()=>{
    expect([1,2,3,20].map(retryDelayMs)).toEqual([30_000,60_000,120_000,21_600_000]);
    const request={actionKey:'work_item.complete',resourceType:'work_item',resourceId:'a',resourceVersion:'v1'};
    expect(approvalDigest(request)).not.toBe(approvalDigest({...request,resourceId:'b'}));
    expect(approvalDigest(request)).not.toBe(approvalDigest({...request,resourceVersion:'v2'}));
    const row={title:'Acción',priority:'high',due_at:null,created_at:'2026-01-01',status:'open'};
    expect(workItemVersion(row)).not.toBe(workItemVersion({...row,title:'Otra acción'}));
  });
  it('prepara Telegram sin red ni datos privados',async()=>{
    expect(renderTelegram('cards.paid','important',{
      resourceType:'card_order',resourceId:'synthetic-1'})).toContain('TEST');
    expect(()=>renderTelegram('unknown','urgent',{resourceType:'card_order',resourceId:'synthetic-1'})).toThrow();
    expect(renderTelegram('daily.brief','informational',{resourceType:'daily_brief',
      resourceId:'2026-10-12',day:'2026-10-12',briefCounts:{priorities:2,followups:3,
        proposals:1,cards:4,incidents:0}})).toContain('2 urgentes, 3 seguimientos');
    expect(()=>renderTelegram('daily.brief','informational',{
      resourceType:'daily_brief',resourceId:'2026-10-12'})).toThrow();
    expect(await simulatedTelegram.deliver({template:'daily.brief',urgency:'informational',
      payload:{resourceType:'daily_brief',resourceId:'2026-10-12'}})).toEqual({result:'simulated'});
  });
  it('bloquea un QR comercial local y muestra la marca fuera del código escaneable',()=>{
    const {canonicalUrl,testUrl}=localTestLink('A'.repeat(32));
    expect(canonicalUrl).toBeNull();
    expect(testUrl).toContain('127.0.0.1');
    const svg=testQrPreview('<svg width="1200" height="1200"></svg>');
    expect(svg).toContain('SOLO TEST · NO IMPRIMIR');
    expect(svg).toContain('y="1200"');
    expect(()=>localTestLink('invalid')).toThrow();
  });
});
