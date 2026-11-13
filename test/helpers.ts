import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { addUser, createWorkspace, importApp, migrate } from '../src/cli/commands.ts';
import { createPool } from '../src/engine/db.ts';
import { buildServer } from '../src/engine/server.ts';

// Integration tests run against a real PostgreSQL. TEST_DATABASE_URL must point at a database where
// the connecting role may CREATE DATABASE and CREATE ROLE (a local superuser is fine).
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost/postgres?host=/tmp/pg';
const ROOT = join(import.meta.dirname, '..');

export interface Env {
   pool: pg.Pool;
   app: ReturnType<typeof buildServer>;
   ws: string;
   schema: string;
   base: string;
   close: () => Promise<void>;
}

export async function setup(specText?: string): Promise<Env> {
   const tag = randomBytes(4).toString('hex');
   const dbName = `rpx_t_${tag}`;
   const admin = new pg.Client({ connectionString: ADMIN_URL });
   await admin.connect();
   await admin.query(`create database ${dbName}`);
   await admin.end();
   const url = new URL(ADMIN_URL);
   url.pathname = `/${dbName}`;
   const pool = createPool(url.toString());

   const ws = `t${tag}`;
   const schema = `${ws}_app`;
   await migrate(pool);
   await createWorkspace(pool, ws, [schema]);
   await pool.query(readFileSync(join(ROOT, 'examples/emp/seed.sql'), 'utf8').replaceAll('demo_app', schema));
   const spec = (specText ?? readFileSync(join(ROOT, 'examples/emp/app.yaml'), 'utf8')).replace(/parsing_schema: \w+/, `parsing_schema: ${schema}`);
   await importApp(pool, ws, spec, 'test');
   await addUser(pool, ws, 'iwan', 'rahasia-123');

   const app = buildServer({ pool, secret: 'x'.repeat(40) });
   await app.ready();
   return {
      pool, app, ws, schema, base: `/r/${ws}/emp`,
      close: async () => {
         await app.close();
         await pool.end();
         const a = new pg.Client({ connectionString: ADMIN_URL });
         await a.connect();
         await a.query(`drop database ${dbName} with (force)`);
         await a.query(`drop role if exists ws_${ws}`).catch(() => {});
         await a.end();
      },
   };
}

/** Minimal browser: keeps cookies, follows nothing automatically. */
export class Browser {
   cookies = new Map<string, string>();
   env: Env;
   constructor(env: Env) { this.env = env; }

   private cookieHeader() {
      return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
   }
   private store(setCookie: string | string[] | undefined) {
      for (const c of [setCookie ?? []].flat()) {
         const [pair] = c.split(';');
         const i = pair.indexOf('=');
         const k = pair.slice(0, i), v = pair.slice(i + 1);
         if (v === '' || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
      }
   }
   async get(url: string) {
      const r = await this.env.app.inject({ method: 'GET', url, headers: { cookie: this.cookieHeader() } });
      this.store(r.headers['set-cookie']);
      return r;
   }
   async post(url: string, form: Record<string, string>) {
      const r = await this.env.app.inject({
         method: 'POST', url, payload: new URLSearchParams(form).toString(),
         headers: { cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      });
      this.store(r.headers['set-cookie']);
      return r;
   }
   /** GET and follow redirects (max 5). */
   async open(url: string) {
      let r = await this.get(url);
      for (let i = 0; i < 5 && r.statusCode >= 300 && r.statusCode < 400; i++) r = await this.get(String(r.headers.location));
      return r;
   }
   async login(user = 'iwan', password = 'rahasia-123') {
      const page = await this.open(`${this.env.base}/login`);
      return this.post(`${this.env.base}/login`, { __csrf: field(page.body, '__csrf')!, username: user, password, return: `${this.env.base}/1` });
   }
}

export function field(body: string, name: string): string | null {
   const m = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(body) ?? new RegExp(`value="([^"]*)"[^>]*name="${name}"`).exec(body);
   return m ? unescape(m[1]) : null;
}

export function links(body: string, cls = 'r-cell-link'): string[] {
   return [...body.matchAll(new RegExp(`class="${cls}" href="([^"]*)"`, 'g'))].map(m => unescape(m[1]));
}

function unescape(s: string): string {
   return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** All form fields of the rendered page (inputs + selected options), ready to post back. */
export function formFields(body: string): Record<string, string> {
   const out: Record<string, string> = {};
   for (const m of body.matchAll(/<input\b[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(m[0])?.[1];
      if (!name || /type="(submit|button)"/.test(m[0])) continue;
      out[name] = unescape(/value="([^"]*)"/.exec(m[0])?.[1] ?? '');
   }
   for (const m of body.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) {
      out[m[1]] = unescape(/<option value="([^"]*)" selected>/.exec(m[2])?.[1] ?? '');
   }
   for (const m of body.matchAll(/<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) out[m[1]] = unescape(m[2]);
   return out;
}
