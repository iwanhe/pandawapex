// Starts a disposable environment for the Playwright suite:
// fresh database, workspace "e2e", seed data, the example app (password login) and the same app
// with SSO against a local mock IdP, then the engine on E2E_PORT.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { addUser, createWorkspace, importApp, migrate } from '../src/cli/commands.ts';
import { createPool } from '../src/engine/db.ts';
import { buildServer } from '../src/engine/server.ts';
import { startMockIdp } from '../test/oidc-mock.ts';
import { E2E } from './env.ts';

const ROOT = join(import.meta.dirname, '..');

const admin = new pg.Client({ connectionString: E2E.adminUrl });
await admin.connect();
await admin.query(`drop database if exists ${E2E.db} with (force)`);
await admin.query(`create database ${E2E.db}`);
await admin.end();

const pool = createPool(E2E.dbUrl);
await migrate(pool);
await createWorkspace(pool, E2E.ws, [E2E.schema]);
await pool.query(readFileSync(join(ROOT, 'examples/emp/seed.sql'), 'utf8').replaceAll('demo_app', E2E.schema));
const spec = readFileSync(join(ROOT, 'examples/emp/app.yaml'), 'utf8').replace(/parsing_schema: \w+/, `parsing_schema: ${E2E.schema}`);
await importApp(pool, E2E.ws, spec, 'e2e');
await addUser(pool, E2E.ws, E2E.user, E2E.password, ['SDM']);
await addUser(pool, E2E.ws, E2E.user2, E2E.password);

const idp = await startMockIdp();
idp.nextUser = { sub: 'e2e-sso-1', email: 'sri.wahyuni@kcsi.co.id', preferred_username: 'sri.wahyuni@kcsi.co.id', groups: ['Gudang'] };
process.env.RPX_E2E_OIDC_SECRET = idp.clientSecret;
await importApp(pool, E2E.ws, spec.replace(/^app: emp$/m, `app: sso
authentication:
  scheme: oidc
  oidc:
    issuer: ${idp.issuer}
    client_id: ${idp.clientId}
    client_secret_env: RPX_E2E_OIDC_SECRET
    allowed_domains: [kcsi.co.id]
    groups_claim: groups
    button_label: Masuk dengan akun KCSI`), 'e2e');

const app = buildServer({
   pool, secret: 'e2e-secret-'.padEnd(48, 'x'), allowInsecureOidc: true,
   publicUrl: `http://localhost:${E2E.port}`, loginRateLimit: 10_000,
});
await app.listen({ port: E2E.port, host: '127.0.0.1' });
writeFileSync(join(ROOT, 'e2e/.state.json'), JSON.stringify({ issuer: idp.issuer }));
console.log(`e2e server on http://localhost:${E2E.port}`);

const stop = async () => { await app.close(); await idp.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
