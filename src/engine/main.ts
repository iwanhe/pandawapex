import { createPool } from './db.ts';
import { startMaintenance } from './maintenance.ts';
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

// expired sessions are removed every RPX_PURGE_MINUTES (default 15; 0 turns it off, e.g. when cron runs `rpx session purge`)
const purgeMinutes = process.env.RPX_PURGE_MINUTES === undefined || process.env.RPX_PURGE_MINUTES === '' ? 15 : Number(process.env.RPX_PURGE_MINUTES);
const stopMaintenance = startMaintenance(pool, app.log, purgeMinutes);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
   process.on(sig, async () => { stopMaintenance(); await app.close(); await pool.end(); process.exit(0); });
}
