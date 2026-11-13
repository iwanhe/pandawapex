// Tiny auto-escaping HTML templates. Everything interpolated is escaped unless it is SafeHtml.
// No template engine dependency: templates are plain TS functions returning SafeHtml.

export class SafeHtml {
   readonly value: string;
   constructor(value: string) { this.value = value; }
   toString(): string { return this.value; }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
   return String(v ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
}

export function raw(v: string): SafeHtml {
   return new SafeHtml(v);
}

type Part = SafeHtml | string | number | boolean | null | undefined | Part[];

function render(v: Part): string {
   if (v === null || v === undefined || v === false) return '';
   if (Array.isArray(v)) return v.map(render).join('');
   if (v instanceof SafeHtml) return v.value;
   return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
   let out = strings[0];
   for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
   return new SafeHtml(out);
}

/** Attribute that is present only when truthy: ${attrIf('disabled', x)} */
export function attrIf(name: string, on: unknown): SafeHtml {
   return new SafeHtml(on ? ` ${name}` : '');
}
