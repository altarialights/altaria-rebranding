import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFromHex(hex: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('gmail_key_unavailable');
  return Buffer.from(hex, 'hex');
}
export function encryptGmailToken(token: string, keyHex: string): string {
  if (!token || token.length > 8192) throw new Error('gmail_token_invalid');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromHex(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}
export function decryptGmailToken(value: string, keyHex: string): string {
  const [version, iv, tag, payload, extra] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !payload || extra) throw new Error('gmail_token_invalid');
  const decipher = createDecipheriv('aes-256-gcm', keyFromHex(keyHex), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}
