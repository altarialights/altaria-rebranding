// Scan files Git would include without printing the secret values.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readProjectEnv } from './lib/test-isolation.mjs';

const names = [
  'TURSO_AUTH_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN', 'WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD',
  'ALTARIA_TEST_DB_MARKER', 'GMAIL_OAUTH_CLIENT_SECRET', 'ALTARIA_GMAIL_TOKEN_KEY',
];
const privateValues = new Set();
for (const env of [readProjectEnv('.env'), readProjectEnv('.env.test')]) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === 'string' && value.length >= 12) privateValues.add(value);
  }
}
if (privateValues.size === 0) throw new Error('No se encontraron secretos privados para contrastar.');
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
if (process.argv.includes('--include-build')) {
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit('dist');
  visit('.vercel/output');
}
const leaks = [];
for (const file of files) {
  let contents;
  try { contents = readFileSync(resolve(file)); } catch { continue; }
  if ([...privateValues].some((value) => contents.includes(Buffer.from(value)))) leaks.push(file);
}
if (leaks.length) {
  console.error(`Valores privados detectados en ${leaks.length} archivos incluidos por Git.`);
  process.exitCode = 1;
} else {
  console.log(`Escaneo de ${files.length} archivos Git${process.argv.includes('--include-build') ? ' y build' : ''}: sin coincidencias con secretos locales.`);
}
