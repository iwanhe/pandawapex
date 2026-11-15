import { createPool } from './db.ts';
import { buildServer, parseBuilderHosts, parseTrustProxy } from './server.ts';

const url = process.env.RPX_DATABASE_URL ?? process.env.DATABASE_URL;
const secret = process.env.RPX_SECRET ?? '';
if (!url) { console.error('RPX_DATABASE_URL (or DATABASE_URL) is not set'); process.exit(1); }

const pool = createPool(url);
const app = buildServer({
   pool, secret, logger: true,
   secureCookies: process.env.RPX_SECURE_COOKIES === '1',
   publicUrl: process.env.RPX_PUBLIC_URL || undefined,
   loginRateLimit: process.env.RPX_LOGIN_RATE_LIMIT ? Number(process.env.RPX_LOGIN_RATE_LIMIT) : undefined,
   trustProxy: parseTrustProxy(process.env.RPX_TRUST_PROXY),
   builderHosts: parseBuilderHosts(process.env.RPX_BUILDER_HOSTS),
});
const port = Number(process.env.PORT ?? 8080);
app.listen({ port, host: process.env.HOST ?? '0.0.0.0' }).catch(err => { app.log.error(err); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
   process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
