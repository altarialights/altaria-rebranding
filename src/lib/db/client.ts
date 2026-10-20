import { connect, type Connection } from '@tursodatabase/serverless';

let client: Connection | null = null;

const readServerEnv = (key: 'TURSO_DATABASE_URL' | 'TURSO_AUTH_TOKEN'): string | undefined => {
  const astroValue = import.meta.env[key];
  if (import.meta.env.DEV && astroValue && process.env[key] && astroValue !== process.env[key]) {
    throw new Error('Configuración Turso ambigua entre Astro y el proceso local.');
  }
  return astroValue || process.env[key];
};

const assertLocalTestDatabase = (url: string): void => {
  const vercelProduction = process.env.VERCEL === '1'
    && process.env.VERCEL_ENV === 'production'
    && process.env.NODE_ENV === 'production';
  if (vercelProduction) return;
  if (process.env.ALTARIA_TEST_ISOLATED !== '1') {
    throw new Error('Turso bloqueado fuera del arranque TEST aislado.');
  }
  const configured = process.env.ALTARIA_TEST_TURSO_URL;
  if (!configured || new URL(url).hostname.toLowerCase() !== new URL(configured).hostname.toLowerCase()) {
    throw new Error('La base Turso no coincide con el destino TEST validado.');
  }
  if (new URL(url).hostname.toLowerCase() === 'altaria-digital-index-altarialights.aws-eu-west-1.turso.io') {
    throw new Error('La base Turso de producción está bloqueada en desarrollo.');
  }
};

export const isAssessmentDemoMode = (): boolean => {
  const value = import.meta.env.ASSESSMENT_DEMO_MODE || process.env.ASSESSMENT_DEMO_MODE;
  const isDevelopment = import.meta.env.DEV || process.env.NODE_ENV === 'development';
  return isDevelopment && value === 'true';
};

export const hasTursoConfiguration = (): boolean =>
  Boolean(readServerEnv('TURSO_DATABASE_URL') && readServerEnv('TURSO_AUTH_TOKEN'));

export const getDatabase = (): Connection => {
  if (client) return client;
  const url = readServerEnv('TURSO_DATABASE_URL');
  const authToken = readServerEnv('TURSO_AUTH_TOKEN');
  if (!url || !authToken) {
    throw new Error('Turso no está configurado. Define TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.');
  }
  assertLocalTestDatabase(url);
  client = connect({ url, authToken });
  return client;
};
