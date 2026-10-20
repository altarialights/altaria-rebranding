import { createHash } from 'node:crypto';

export const madridDay = (date: Date): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export const madridTime = (date: Date): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);

export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('invalid_attempt');
  return Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempt - 1, 10));
}

export function approvalDigest(request: {
  actionKey: string; resourceType: string; resourceId: string; resourceVersion: string;
}) {
  return createHash('sha256').update(JSON.stringify([
    request.actionKey, request.resourceType, request.resourceId, request.resourceVersion,
  ])).digest('hex');
}

export function workItemVersion(row: {title: unknown; priority: unknown; due_at: unknown;
  created_at: unknown; status: unknown}) {
  return createHash('sha256').update(JSON.stringify([
    row.title, row.priority, row.due_at, row.created_at, row.status,
  ])).digest('hex');
}

export const safeErrorCode = (error: unknown): string => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'provider_error';
  return /^[a-z][a-z0-9_]{2,60}$/.test(code) ? code : 'provider_error';
};
