// Read-only staging inventory; never emits user identities or credentials.
import { WorkOS } from '@workos-inc/node';
import { assertStagingWorkOS, assertTestDatabase, assertTestStripe, readProjectEnv } from './lib/test-isolation.mjs';

const prod = readProjectEnv('.env');
const test = readProjectEnv('.env.test');
if (!test) throw new Error('Falta .env.test.');
assertTestDatabase({ targetUrl: test.TURSO_DATABASE_URL, token: test.TURSO_AUTH_TOKEN,
  approvedUrl: test.ALTARIA_TEST_TURSO_URL, productionEnv: prod });
assertTestStripe({ mode: test.STRIPE_MODE, secretKey: test.STRIPE_SECRET_KEY,
  webhookSecret: test.STRIPE_WEBHOOK_SECRET, productionEnv: prod });
assertStagingWorkOS({ clientId: test.WORKOS_CLIENT_ID, apiKey: test.WORKOS_API_KEY,
  redirectUri: test.WORKOS_REDIRECT_URI, cookiePassword: test.WORKOS_COOKIE_PASSWORD,
  productionEnv: prod });
const workos = new WorkOS(test.WORKOS_API_KEY, { clientId: test.WORKOS_CLIENT_ID });
const [users, organizations, events] = await Promise.all([
  workos.userManagement.listUsers({ limit: 10 }),
  workos.organizations.listOrganizations({ limit: 10 }),
  workos.events.listEvents({ events: ['authentication.oauth_succeeded', 'authentication.mfa_succeeded'],
    rangeStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), limit: 100 }),
]);
const connections = await workos.sso.listConnections({ limit: 10 });
let verifiedUser = null;
if (users.data.length === 1) {
  const user = users.data[0];
  const [identities, factors, sessions] = await Promise.all([
    workos.userManagement.getUserIdentities(user.id),
    workos.multiFactorAuth.listUserAuthFactors({ userId: user.id, limit: 20 }),
    workos.userManagement.listSessions(user.id, { limit: 20 }),
  ]);
  const eventMatches = (name) => events.data.some((event) => event.event === name
    && event.data.userId === user.id && event.context?.client_id === test.WORKOS_CLIENT_ID);
  verifiedUser = {
    emailVerified: user.emailVerified,
    googleIdentityOnly: identities.length === 1 && identities[0].provider === 'GoogleOAuth',
    totpEnrolled: factors.data.some((factor) => factor.type === 'totp'),
    activeOAuthSession: sessions.data.some((session) => session.status === 'active' && session.authMethod === 'oauth'),
    oauthSuccessEventForApp: eventMatches('authentication.oauth_succeeded'),
    mfaSuccessEventForApp: eventMatches('authentication.mfa_succeeded'),
  };
}
console.log(JSON.stringify({ workosStaging: true, usersOnFirstPage: users.data.length,
  organizationsOnFirstPage: organizations.data.length, ssoConnectionsOnFirstPage: connections.data.length,
  authEventsOnFirstPage: events.data.length, verifiedUser }));
