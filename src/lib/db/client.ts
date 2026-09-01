import { connect, type Connection } from '@tursodatabase/serverless';

let client: Connection | null = null;

const readServerEnv = (key: 'TURSO_DATABASE_URL' | 'TURSO_AUTH_TOKEN'): string | undefined => {
  const astroValue = import.meta.env[key];
  return astroValue || process.env[key];
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
  client = connect({ url, authToken });
  return client;
};
