import { SpecError } from '../spec/import.ts';

/** A message the developer can act on. On Windows, "localhost" resolves to ::1 and 127.0.0.1, and a refused connection
 *  arrives as an AggregateError with an empty message, which used to print only "error:". */
export function explain(e: unknown, url = process.env.DATABASE_URL ?? ''): string {
   if (e instanceof SpecError) return e.message;
   const err = e as { message?: string; code?: string; errors?: { message?: string; code?: string }[] };
   const code = err.code ?? err.errors?.find(x => x.code)?.code;
   const where = (() => { try { const u = new URL(url); return `${u.hostname || 'localhost'}:${u.port || 5432}`; } catch { return 'DATABASE_URL'; } })();
   const db = (() => { try { return new URL(url).pathname.slice(1) || 'postgres'; } catch { return ''; } })();
   switch (code) {
      case 'ECONNREFUSED': return `error: PostgreSQL tidak bisa dihubungi di ${where}. Nyalakan dulu (mis. start-pg.bat), lalu ulangi.`;
      case 'ENOTFOUND': return `error: host database di DATABASE_URL tidak dikenal (${where}).`;
      case 'ETIMEDOUT': return `error: koneksi ke PostgreSQL di ${where} habis waktu.`;
      case '3D000': return `error: database "${db}" belum ada. Buat dulu: psql -U postgres -c "create database ${db}"`;
      case '28P01': case '28000': return `error: PostgreSQL menolak login (${err.message}). Periksa user dan kata sandi di DATABASE_URL.`;
   }
   const msg = err.message || err.errors?.map(x => x.message).filter(Boolean).join('; ') || String(e);
   return `error: ${msg}${code ? ` (${code})` : ''}`;
}
