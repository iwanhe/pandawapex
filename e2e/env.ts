const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost/postgres?host=/tmp/pg';
const db = 'rpx_e2e';
const dbUrl = (() => { const u = new URL(adminUrl); u.pathname = `/${db}`; return u.toString(); })();

export const E2E = {
   adminUrl, db, dbUrl,
   port: Number(process.env.E2E_PORT ?? 8099),
   ws: 'e2e', schema: 'e2e_app',
   user: 'iwan', user2: 'dewi', password: 'rahasia-e2e-123',
};
