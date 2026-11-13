#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createPool } from '../engine/db.ts';
import { SpecError } from '../spec/import.ts';
import { addUser, createWorkspace, importApp, migrate } from './commands.ts';

const USAGE = `rpx <command>

  db migrate                                         apply db/migrations
  ws create <name> --schema <s> [--schema <s2>]      create workspace + role ws_<name>
  app import <file.yaml> --ws <name>                 validate and import an app spec
  app check <file.yaml>                              validate a spec without a database
  user add --ws <name> --username <u> --password <p> [--group <g>]

Environment: DATABASE_URL (owner/superuser connection for these admin commands)`;

async function main(): Promise<number> {
   const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
         schema: { type: 'string', multiple: true },
         ws: { type: 'string' },
         username: { type: 'string' },
         password: { type: 'string' },
         group: { type: 'string', multiple: true },
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
   console.error(e instanceof SpecError ? e.message : `error: ${e.message}`);
   process.exit(1);
});
