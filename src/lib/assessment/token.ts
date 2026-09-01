import { QUESTION_KEYS } from './questionnaires/v1';
import type { AnswerValue, AssessmentAnswers, QuestionKey } from './types';

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const createResultToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const hashResultToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createDemoResultToken = (answers: AssessmentAnswers): string => {
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, answers }));
  return `demo_${bytesToBase64Url(payload)}`;
};

export const readDemoResultToken = (token: string): AssessmentAnswers | null => {
  if (!token.startsWith('demo_') || token.length > 1024) return null;
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.slice(5))));
    if (!decoded || typeof decoded !== 'object' || !('v' in decoded) || !('answers' in decoded)) return null;
    const candidate = decoded as { v: unknown; answers: unknown };
    if (candidate.v !== 1 || !candidate.answers || typeof candidate.answers !== 'object') return null;
    const entries = Object.entries(candidate.answers);
    const isQuestionKey = (key: string): key is QuestionKey =>
      QUESTION_KEYS.some((questionKey) => questionKey === key);
    const isAnswerValue = (value: unknown): value is AnswerValue =>
      value === null || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
    if (entries.length !== QUESTION_KEYS.length || entries.some(([key, value]) => !isQuestionKey(key) || !isAnswerValue(value))) return null;
    const answers: AssessmentAnswers = {};
    entries.forEach(([key, value]) => {
      if (isQuestionKey(key) && isAnswerValue(value)) answers[key] = value;
    });
    return QUESTION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(answers, key)) ? answers : null;
  } catch {
    return null;
  }
};
