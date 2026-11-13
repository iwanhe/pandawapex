// Bind-variable translator: APEX-style `:P1_ITEM` -> PostgreSQL.
//   mode 'sql'     -> positional params ($1, $2, ...) + ordered list of item names (same name = same $n)
//   mode 'plpgsql' -> rpx_rt.v('P1_ITEM') calls (DO blocks cannot take parameters)
// It tokenizes just enough of PostgreSQL to skip string literals, quoted identifiers,
// dollar-quoted bodies, comments, `::` casts and `:=` assignments. Never a string replace.

export type BindMode = 'sql' | 'plpgsql';

export interface BindResult {
   text: string;
   names: string[];          // sql mode: names[i] binds to $(i+1); plpgsql mode: distinct names referenced
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;

export function translateBinds(src: string, mode: BindMode): BindResult {
   const out: string[] = [];
   const names: string[] = [];
   const index = new Map<string, number>();
   let i = 0;
   const n = src.length;

   const copyUntil = (end: number) => { out.push(src.slice(i, end)); i = end; };

   while (i < n) {
      const c = src[i];
      const c2 = src[i + 1];

      // -- line comment
      if (c === '-' && c2 === '-') {
         const e = src.indexOf('\n', i);
         copyUntil(e === -1 ? n : e + 1);
         continue;
      }
      // /* block comment */ (PostgreSQL allows nesting)
      if (c === '/' && c2 === '*') {
         let depth = 0, j = i;
         while (j < n) {
            if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; continue; }
            if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; if (depth === 0) break; continue; }
            j++;
         }
         copyUntil(Math.min(j, n));
         continue;
      }
      // 'string' / E'string' (handles '' and, for E-strings, backslash escapes)
      if (c === "'") {
         const isE = i > 0 && /[eE]/.test(src[i - 1]) && (i < 2 || !IDENT_CHAR.test(src[i - 2]));
         let j = i + 1;
         while (j < n) {
            if (isE && src[j] === '\\') { j += 2; continue; }
            if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } j++; break; }
            j++;
         }
         copyUntil(j);
         continue;
      }
      // "quoted identifier"
      if (c === '"') {
         let j = i + 1;
         while (j < n) {
            if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } j++; break; }
            j++;
         }
         copyUntil(j);
         continue;
      }
      // $tag$ dollar-quoted $tag$   (not $1 positional params)
      if (c === '$' && (i === 0 || !IDENT_CHAR.test(src[i - 1]))) {
         const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
         if (m) {
            const tag = m[0];
            const e = src.indexOf(tag, i + tag.length);
            copyUntil(e === -1 ? n : e + tag.length);   // literal text in both modes
            continue;
         }
      }
      // ::cast and := assignment
      if (c === ':' && (c2 === ':' || c2 === '=')) { copyUntil(i + 2); continue; }

      // :BIND  (not preceded by an identifier char, ']' or ')', e.g. arr[a:b])
      if (c === ':' && c2 !== undefined && IDENT_START.test(c2)
          && (i === 0 || !/[A-Za-z0-9_\])]/.test(src[i - 1]))) {
         let j = i + 1;
         while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
         const name = src.slice(i + 1, j).toUpperCase();
         if (mode === 'sql') {
            let k = index.get(name);
            if (k === undefined) { names.push(name); k = names.length; index.set(name, k); }
            out.push(`$${k}`);
         } else {
            if (!index.has(name)) { index.set(name, names.length); names.push(name); }
            out.push(`rpx_rt.v('${name}')`);
         }
         i = j;
         continue;
      }
      out.push(c);
      i++;
   }
   return { text: out.join(''), names };
}

// Wrap a translated PL/pgSQL body as a DO block with a tag the body cannot contain.
export function wrapDoBlock(body: string): string {
   let tag = '$rpx$';
   for (let k = 0; body.includes(tag); k++) tag = `$rpx${k}$`;
   const trimmed = body.trim();
   const hasBegin = /^(declare|begin)\b/i.test(trimmed);
   const block = hasBegin ? trimmed : `begin\n${trimmed}\nend;`;
   return `do ${tag}\n${block}\n${tag}`;
}
