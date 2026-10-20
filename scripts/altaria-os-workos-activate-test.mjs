// Enable private staging checks only after TEST isolation and real Google + TOTP evidence.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--apply-test') || process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error('Se requiere --apply-test en un entorno local.');
}
const runCheck = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url))], {
  encoding: 'utf8', windowsHide: true,
}));
const isolation = runCheck('./altaria-os-test-inspect.mjs');
if (!isolation.tursoTestIdentity || !isolation.stripeTestIdentity
  || !isolation.workosStagingIdentity || !isolation.tokenValid || !isolation.markerVerified) {
  throw new Error('El aislamiento TEST no se verificó.');
}
const staging = runCheck('./altaria-os-workos-staging-inspect.mjs');
const evidence = staging.verifiedUser;
if (!staging.workosStaging || staging.usersOnFirstPage !== 1 || staging.ssoConnectionsOnFirstPage !== 0
  || !evidence || Object.values(evidence).some((value) => value !== true)) {
  throw new Error('No hay prueba completa de Google OAuth y MFA en WorkOS staging.');
}
const file = new URL('../.env.test', import.meta.url);
let contents = readFileSync(file, 'utf8');
for (const name of ['ALTARIA_WORKOS_MFA_VERIFIED', 'ALTARIA_WORKOS_GOOGLE_ONLY_VERIFIED']) {
  const matches = [...contents.matchAll(new RegExp(`^${name}=(0|1)$`, 'gm'))];
  if (matches.length !== 1) throw new Error(`La bandera ${name} falta o es ambigua.`);
  contents = contents.replace(new RegExp(`^${name}=0$`, 'm'), `${name}=1`);
}
writeFileSync(file, contents, 'utf8');
console.log('Políticas Google y MFA reales verificadas; banderas locales TEST activadas.');
