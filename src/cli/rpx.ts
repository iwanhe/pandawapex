#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createPool } from '../engine/db.ts';
import { explain } from './errors.ts';
import { addDeveloper, addUser, createWorkspace, importApp, migrate, PILOT_USERS, setupPilot } from './commands.ts';
import { exportSpec, specToYaml } from '../spec/export.ts';
import { backup, databaseOf, restore } from './backup.ts';
import { purgeSessions } from '../engine/maintenance.ts';

const USAGE = `rpx <command>

  db migrate                                         apply db/migrations
  ws create <name> --schema <s> [--schema <s2>]      create workspace + role ws_<name>
  app import <file.yaml> --ws <name>                 validate and import an app spec
  app check <file.yaml>                              validate a spec without a database
  app export <alias> --ws <name> [--out <file.yaml>] spec rebuilt from the database (default: to stdout)
  user add --ws <name> --username <u> --password <p> [--group <g>]
  dev add --ws <name> --username <u> --password <p> [--email <e>] [--admin]
                                                     developer account for the builder (/builder)
  session purge                                      delete expired application and developer sessions
                                                     (the server also does this every RPX_PURGE_MINUTES)
  backup [--dir <folder>] [--keep <n>]               pg_dump of this database + the roles it needs, into <folder>
                                                     (default: backups); --keep deletes older backups beyond n
  restore <file.dump> --to <database>                restore a backup into a new (or empty) database on this server
  demo setup                                         migrate + workspace "demo" + contoh data + app emp + user
                                                     (RPX_DEMO_USER, RPX_DEMO_PASSWORD); aman dijalankan ulang
  pilot setup                                        migrate + workspace "pandawa" + aplikasi DEMO Permintaan Barang
                                                     (port dari APEX) + user per role (RPX_DEMO_PASSWORD)

Environment: DATABASE_URL (owner/superuser connection for these admin commands);
             PGHOME or PGBIN (where pg_dump and pg_restore are, when not on the PATH)`;

async function main(): Promise<number> {
   const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
         schema: { type: 'string', multiple: true },
         ws: { type: 'string' },
         username: { type: 'string' },
         password: { type: 'string' },
         group: { type: 'string', multiple: true },
         out: { type: 'string' },
         email: { type: 'string' },
         admin: { type: 'boolean' },
         dir: { type: 'string' },
         keep: { type: 'string' },
         to: { type: 'string' },
         help: { type: 'boolean', short: 'h' },
      },
   });
   const [cmd, sub, arg] = positionals;
   if (values.help || !cmd) { console.log(USAGE); return cmd ? 0 : 1; }

   if (cmd === 'app' && sub === 'check') {
      const { parseSpec } = await import('../spec/import.ts');
      const spec = parseSpec(readFileSync(need(arg, 'file'), 'utf8'));
      console.log(`ok: ${spec.app}, ${spec.pages.length} page(s)`);
      return 0;
   }

   const url = process.env.DATABASE_URL;
   if (!url) { console.error('DATABASE_URL is not set'); return 1; }
   // these two open their own connections (restore works on a database that does not exist yet)
   if (cmd === 'backup') {
      const dir = values.dir ?? 'backups';
      const r = await backup(url, dir, { keep: values.keep === undefined ? undefined : Number(values.keep) });
      // paths as the user wrote them (inside Docker the absolute path is the container's, not the host's)
      console.log(`backup selesai: ${join(dir, basename(r.dump))} (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`role          : ${join(dir, basename(r.roles))}`);
      if (r.removed.length) console.log(`backup lama dihapus: ${r.removed.join(', ')}`);
      console.log('Kedua file itu satu pasang. Salin keduanya ke tempat lain selain komputer ini.');
      return 0;
   }
   if (cmd === 'restore') {
      const r = await restore(url, need(sub, 'file.dump'), need(values.to, '--to'), m => console.log(m));
      console.log(`restore selesai ke database "${r.database}": ${r.workspaces} workspace, ${r.applications} aplikasi, ${r.appUsers} pengguna aplikasi, ${r.developers} developer.`);
      console.log(r.database === databaseOf(url)
         ? 'Ini database yang ditunjuk DATABASE_URL: jalankan server seperti biasa. Semua pengguna login ulang.'
         : `Database "${r.database}" belum dipakai server. Langkah berikutnya: docs/operasional.md, bagian "Memakai database hasil restore".`);
      return 0;
   }

   const pool = createPool(url);
   try {
      if (cmd === 'db' && sub === 'migrate') {
         await migrate(pool, m => console.log(m));
      } else if (cmd === 'ws' && sub === 'create') {
         const r = await createWorkspace(pool, need(arg, 'name'), values.schema ?? []);
         console.log(`workspace ${arg} ready (role ${r.role})`);
      } else if (cmd === 'app' && sub === 'import') {
         const r = await importApp(pool, need(values.ws, '--ws'), readFileSync(need(arg, 'file'), 'utf8'));
         console.log(`${r.replaced ? 'replaced' : 'created'} app ${r.appId}: ${r.pages} pages, ${r.regions} regions, ${r.items} items`);
      } else if (cmd === 'app' && sub === 'export') {
         const ws = need(values.ws, '--ws');
         const yaml = specToYaml(await exportSpec(pool, ws, need(arg, 'alias')), { workspace: ws, exportedBy: `cli:${process.env.USER ?? process.env.USERNAME ?? 'cli'}` });
         if (values.out) {
            writeFileSync(values.out, yaml);
            console.error(`exported ${arg} to ${values.out}`);
         } else {
            process.stdout.write(yaml);
         }
      } else if (cmd === 'session' && sub === 'purge') {
         const r = await purgeSessions(pool);
         console.log(r ? `removed ${r.appSessions} application session(s) and ${r.devSessions} developer session(s)` : 'another purge is running; nothing done');
      } else if (cmd === 'dev' && sub === 'add') {
         await addDeveloper(pool, need(values.ws, '--ws'), need(values.username, '--username'), need(values.password, '--password'),
            { email: values.email, admin: values.admin ?? false });
         console.log(`developer ${values.username} ready in workspace ${values.ws}; sign in at /builder`);
      } else if (cmd === 'demo' && sub === 'setup') {
         const user = process.env.RPX_DEMO_USER || 'admin';
         const password = process.env.RPX_DEMO_PASSWORD ?? '';
         if (password.length < 10) throw new Error('RPX_DEMO_PASSWORD must be set (at least 10 characters)');
         await migrate(pool, m => console.log(m));
         await createWorkspace(pool, 'demo', ['demo_app']);
         const root = new URL('../../', import.meta.url);
         await pool.query(readFileSync(new URL('examples/emp/seed.sql', root), 'utf8'));
         const r = await importApp(pool, 'demo', readFileSync(new URL('examples/emp/app.yaml', root), 'utf8'));
         await addUser(pool, 'demo', user, password, ['SDM']);
         await addDeveloper(pool, 'demo', user, password, { admin: true });   // builder sign-in (/builder)
         await addUser(pool, 'demo', 'tamu', password);
         console.log(`demo ready: app ${r.appId}; users "${user}" (grup SDM) and "tamu" (hanya lihat), same password. Open /r/demo/emp`);
      } else if (cmd === 'pilot' && sub === 'setup') {
         const password = process.env.RPX_DEMO_PASSWORD ?? '';
         if (password.length < 10) throw new Error('RPX_DEMO_PASSWORD must be set (at least 10 characters)');
         await migrate(pool, m => console.log(m));
         const r = await setupPilot(pool, password);
         console.log(`pilot ready: app ${r.appId} (${r.pages} pages); users ${PILOT_USERS.map(([u, role]) => `${u} (${role})`).join(', ')}, same password. Open /r/pandawa/demo`);
      } else if (cmd === 'user' && sub === 'add') {
         await addUser(pool, need(values.ws, '--ws'), need(values.username, '--username'), need(values.password, '--password'), values.group ?? []);
         console.log(`user ${values.username} saved`);
      } else {
         console.log(USAGE);
         return 1;
      }
      return 0;
   } finally {
      await pool.end();
   }
}

function need(v: string | undefined, what: string): string {
   if (!v) throw new Error(`missing ${what}`);
   return v;
}

main().then(code => process.exit(code), e => {
   console.error(explain(e));
   process.exit(1);
});
