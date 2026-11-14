import type pg from 'pg';

// Reads tables of a workspace schema from the PostgreSQL catalog for the Create App wizard (B3), and decides
// what the wizard can build on each: report + form, report only, or nothing (with the reason, shown to the developer).
// Privileges are checked for the workspace role, because generated pages run as that role.

export type ColumnKind = 'text' | 'longtext' | 'integer' | 'number' | 'date' | 'timestamp' | 'boolean' | 'uuid' | 'enum' | 'unsupported';

export interface ColumnInfo {
   name: string;
   attnum: number;
   type: string;          // format_type(), for display
   kind: ColumnKind;
   notNull: boolean;
   hasDefault: boolean;   // default, identity or serial
   generated: boolean;
   maxLength: number | null;
   enumValues: string[];
}

export interface ForeignKey { column: string; refSchema: string; refTable: string; refColumn: string; display: string }

export interface TableInfo {
   schema: string;
   name: string;
   kind: 'table' | 'view';
   comment: string | null;
   rowEstimate: number | null;
   columns: ColumnInfo[];
   pk: string[];
   fks: ForeignKey[];
   canSelect: boolean;
   canWrite: boolean;      // insert, update and delete
   /** what the wizard builds: 'form' = report + form, 'report' = report only, 'none' = not offered */
   build: 'form' | 'report' | 'none';
   reason: string | null;  // why not (more), in the developer's language
}

const SIMPLE = /^[a-z_][a-z0-9_$]*$/;
const LABEL_HINT = ['nama', 'name', 'judul', 'title', 'label', 'deskripsi', 'description', 'keterangan', 'kode', 'code'];

function kindOf(typname: string, category: string, isEnum: boolean): ColumnKind {
   if (isEnum) return 'enum';
   switch (typname) {
      case 'int2': case 'int4': case 'int8': return 'integer';
      case 'numeric': case 'float4': case 'float8': case 'money': return 'number';
      case 'date': return 'date';
      case 'timestamp': case 'timestamptz': return 'timestamp';
      case 'bool': return 'boolean';
      case 'uuid': return 'uuid';
      case 'text': case 'varchar': case 'bpchar': case 'citext': case 'name': return 'text';
   }
   return category === 'S' ? 'text' : 'unsupported';
}

/** the column shown instead of a foreign key value: a "name"-like text column, else the first text column, else the key */
export function displayColumn(cols: ColumnInfo[], pk: string[]): string {
   const text = cols.filter(c => (c.kind === 'text' || c.kind === 'longtext') && !pk.includes(c.name) && SIMPLE.test(c.name));
   for (const hint of LABEL_HINT) {
      const hit = text.find(c => c.name === hint || c.name.startsWith(`${hint}_`) || c.name.endsWith(`_${hint}`));
      if (hit) return hit.name;
   }
   return text[0]?.name ?? pk[0] ?? cols[0]?.name;
}

export async function listTables(pool: pg.Pool, schema: string, role: string): Promise<TableInfo[]> {
   const rels = await pool.query(
      `select c.oid::int as oid, c.relname, c.relkind::text as relkind, obj_description(c.oid, 'pg_class') as comment
            , case when c.reltuples >= 0 then c.reltuples::bigint end as est
            , has_table_privilege($2, c.oid, 'select') as can_select
            , has_table_privilege($2, c.oid, 'insert') and has_table_privilege($2, c.oid, 'update')
              and has_table_privilege($2, c.oid, 'delete') as can_write
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition
        order by c.relname`, [schema, role]);
   if (!rels.rowCount) return [];
   const oids: number[] = rels.rows.map(r => r.oid);
   const cons = await pool.query(
      `select k.conrelid::int as rel, k.contype::text as type, k.conkey, k.confkey, k.confrelid::int as ref
            , rn.nspname as ref_schema, rc.relname as ref_table
            , case when k.contype = 'f' then has_table_privilege($2, k.confrelid, 'select') end as ref_ok
         from pg_constraint k
         left join pg_class rc on rc.oid = k.confrelid
         left join pg_namespace rn on rn.oid = rc.relnamespace
        where k.conrelid = any($1) and k.contype in ('p', 'f')`, [oids, role]);
   const refOids = [...new Set(cons.rows.filter(r => r.type === 'f').map(r => r.ref as number))];
   const cols = await pool.query(
      `select a.attrelid::int as rel, a.attnum::int as attnum, a.attname, format_type(a.atttypid, a.atttypmod) as type
            , b.typname, b.typcategory::text as category, b.typtype = 'e' as is_enum, a.attnotnull
            , a.atthasdef or a.attidentity <> '' as has_default, a.attgenerated <> '' as generated
            , case when b.typname in ('varchar', 'bpchar') and a.atttypmod > 4 then a.atttypmod - 4 end as max_len
            , case when b.typtype = 'e' then (select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e where e.enumtypid = b.oid) end as enum_values
         from pg_attribute a
         join pg_type t on t.oid = a.atttypid
         join pg_type b on b.oid = case when t.typtype = 'd' then t.typbasetype else t.oid end
        where a.attrelid = any($1) and a.attnum > 0 and not a.attisdropped
        order by a.attrelid, a.attnum`, [[...oids, ...refOids]]);

   const byRel = new Map<number, ColumnInfo[]>();
   for (const r of cols.rows) {
      const kind = kindOf(r.typname, r.category, r.is_enum);
      const c: ColumnInfo = {
         name: r.attname, attnum: r.attnum, type: r.type,
         kind: kind === 'text' && (r.typname === 'text' ? false : (r.max_len ?? 0) > 250) ? 'longtext' : kind,
         notNull: r.attnotnull, hasDefault: r.has_default, generated: r.generated, maxLength: r.max_len, enumValues: r.enum_values ?? [],
      };
      (byRel.get(r.rel) ?? byRel.set(r.rel, []).get(r.rel)!).push(c);
   }
   const nameAt = (rel: number, attnum: number) => byRel.get(rel)?.find(c => c.attnum === attnum)?.name ?? '';
   const pkOf = (rel: number) => {
      const p = cons.rows.find(r => r.rel === rel && r.type === 'p');
      return p ? (p.conkey as number[]).map(n => nameAt(rel, n)) : [];
   };

   return rels.rows.map(r => {
      const columns = byRel.get(r.oid) ?? [];
      const pk = pkOf(r.oid);
      const fks: ForeignKey[] = cons.rows
         .filter(k => k.rel === r.oid && k.type === 'f' && k.ref_ok && (k.conkey as number[]).length === 1)
         .map(k => {
            const refCols = byRel.get(k.ref) ?? [];
            return {
               column: nameAt(r.oid, k.conkey[0]), refSchema: k.ref_schema, refTable: k.ref_table,
               refColumn: nameAt(k.ref, k.confkey[0]), display: displayColumn(refCols, pkOf(k.ref)),
            };
         })
         .filter(f => SIMPLE.test(f.refTable) && SIMPLE.test(f.refSchema) && SIMPLE.test(f.display) && SIMPLE.test(f.refColumn));
      const t: TableInfo = {
         schema, name: r.relname, kind: r.relkind === 'v' || r.relkind === 'm' ? 'view' : 'table', comment: r.comment,
         rowEstimate: r.est === null ? null : Number(r.est), columns, pk, fks,
         canSelect: r.can_select, canWrite: r.can_write, build: 'none', reason: null,
      };
      decide(t, role);
      return t;
   });
}

/** report + form, report only, or nothing; with the reason */
function decide(t: TableInfo, role: string): void {
   const usable = t.columns.filter(c => c.kind !== 'unsupported' && SIMPLE.test(c.name));
   if (!SIMPLE.test(t.name)) { t.reason = 'Nama tabel memakai huruf besar atau karakter khusus; belum didukung wizard.'; return; }
   if (!t.canSelect) { t.reason = `Role ${role} tidak punya hak SELECT pada tabel ini.`; return; }
   if (!usable.length) { t.reason = 'Tidak ada kolom dengan tipe yang didukung.'; return; }
   t.build = 'report';
   if (t.kind === 'view') { t.reason = 'View: hanya report.'; return; }
   if (!t.pk.length) { t.reason = 'Tidak punya primary key: hanya report.'; return; }
   if (t.pk.some(p => !SIMPLE.test(p) || t.columns.find(c => c.name === p)!.kind === 'unsupported')) { t.reason = 'Nama atau tipe kolom primary key belum didukung: hanya report.'; return; }
   const noDefault = t.pk.filter(p => !t.columns.find(c => c.name === p)!.hasDefault);
   if (noDefault.length) {
      t.reason = `Primary key ${noDefault.join(', ')} tidak punya nilai default (identity/serial): form belum bisa menambah baris, jadi hanya report.`;
      return;
   }
   if (!t.canWrite) { t.reason = `Role ${role} tidak punya hak INSERT/UPDATE/DELETE: hanya report.`; return; }
   const blocked = t.columns.filter(c => c.notNull && !c.hasDefault && !c.generated && (c.kind === 'unsupported' || !SIMPLE.test(c.name)));
   if (blocked.length) {
      t.reason = `Kolom wajib ${blocked.map(c => c.name).join(', ')} bertipe yang belum didukung form: hanya report.`;
      return;
   }
   t.build = 'form';
}
