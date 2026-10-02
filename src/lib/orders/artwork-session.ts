import { createHash, randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
const name = 'altaria_artwork_session';
export function artworkOwner(cookies: AstroCookies | undefined, create = false, secure = true): string {
  if (!cookies) return '';
  let secret = cookies.get(name)?.value;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) {
    if (!create) return '';
    secret = randomBytes(32).toString('hex');
    cookies.set(name, secret, { httpOnly:true, secure, sameSite:'strict', path:'/', maxAge:86400 });
  }
  return createHash('sha256').update(secret).digest('hex');
}
