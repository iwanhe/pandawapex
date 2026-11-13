import { toText } from './db.ts';
import { html, type SafeHtml } from './html.ts';
import type { RegionDef } from './model.ts';
import type { View } from './runtime.ts';
import { icon } from './templates.ts';
import { inSavepoint, pgMessage, runSql } from './usercode.ts';

// Chart region: source.sql returns (label, value). Server-rendered SVG, no chart library and no script:
//  - bar: one series, horizontal bars in one hue, value printed at the end of each bar
//  - pie: a donut in the categorical palette, legend with value and share (identity is never colour alone)
// Both have a table view (details/summary) and a <title> per mark for the hover tooltip.
// Colours are CSS classes (r-chart-s1..s8 / r-chart-bar), not inline styles: the CSP allows no inline style.

const MAX_SLICES = 7;   // the 8th slot becomes "Lainnya"; never a generated 9th hue
const NUM = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

interface Point { label: string; value: number }

export async function renderChart(v: View, r: RegionDef): Promise<SafeHtml> {
   const c = v.ev.c;
   const res = await inSavepoint(c, () => runSql(c, v.ctx, r.source!));
   if (!res.ok) return html`<p class="r-error-text">${icon('circle-x')} Grafik gagal dimuat: ${pgMessage(res.error)}</p>`;
   const points: Point[] = res.value.rows
      .map(row => ({ label: toText(row[0]) ?? '(kosong)', value: Number(toText(row[1]) ?? 0) }))
      .filter(p => Number.isFinite(p.value));
   if (!points.length || points.every(p => p.value === 0)) {
      return html`<div class="r-empty"><p class="r-empty__title">${r.emptyText ?? 'Belum ada data.'}</p></div>`;
   }
   const cfg = r.chart!;
   const fmt = (n: number) => (cfg.format === 'integer' ? INT : NUM).format(n);
   const name = r.title ?? r.staticId;
   const body = cfg.type === 'pie' ? pie(points, fmt, name) : bars(points, fmt, name);
   return html`<figure class="r-chart">${body}
      <details class="r-chart__table"><summary>Tampilkan sebagai tabel</summary>
         <table class="r-table"><caption class="r-sr-only">${name}</caption>
            <thead><tr><th scope="col">Label</th><th scope="col" class="r-num">${cfg.value_label ?? 'Nilai'}</th></tr></thead>
            <tbody>${points.map(p => html`<tr><td>${p.label}</td><td class="r-num">${fmt(p.value)}</td></tr>`)}</tbody>
         </table>
      </details>
   </figure>`;
}

function bars(points: Point[], fmt: (n: number) => string, name: string): SafeHtml {
   const max = Math.max(...points.map(p => p.value), 0);
   // negative values would need a centred baseline; clamp to zero and still print the real number
   const pct = (n: number) => (max > 0 ? Math.max(0, n) / max * 100 : 0);
   return html`<ul class="r-chart-bars" aria-label="${name}">
      ${points.map(p => html`<li class="r-chart-bars__row">
         <span class="r-chart-bars__label">${p.label}</span>
         <svg class="r-chart-bars__track" width="100%" height="12" aria-hidden="true" focusable="false">
            <rect class="r-chart-bar" x="0" y="0" height="12" rx="4" width="${pct(p.value).toFixed(2)}%"><title>${p.label}: ${fmt(p.value)}</title></rect>
         </svg>
         <span class="r-chart-bars__value">${fmt(p.value)}</span>
      </li>`)}
   </ul>`;
}

function pie(points: Point[], fmt: (n: number) => string, name: string): SafeHtml {
   let slices = points.filter(p => p.value > 0);
   if (slices.length > MAX_SLICES + 1) {
      const rest = slices.slice(MAX_SLICES).reduce((a, p) => a + p.value, 0);
      slices = [...slices.slice(0, MAX_SLICES), { label: 'Lainnya', value: rest }];
   }
   const total = slices.reduce((a, p) => a + p.value, 0);
   const GAP = 0.8;   // ≈ 2px of surface between slices (pathLength 100 on a ~250px circumference)
   let at = 0;
   const arcs = slices.map((p, i) => {
      const share = p.value / total * 100;
      const len = slices.length > 1 ? Math.max(share - GAP, 0.01) : 100;
      const cls = p.label === 'Lainnya' && i === MAX_SLICES ? 'r-chart-other' : `r-chart-s${i + 1}`;
      const arc = html`<circle class="${cls}" cx="60" cy="60" r="44" fill="none" stroke-width="22" pathLength="100"
         stroke-dasharray="${len.toFixed(3)} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(-at).toFixed(3)}"><title>${p.label}: ${fmt(p.value)} (${Math.round(share)}%)</title></circle>`;
      at += share;
      return { arc, cls, p, share };
   });
   return html`<div class="r-chart-pie">
      <svg class="r-chart-pie__donut" viewBox="0 0 120 120" role="img" aria-label="${name}: ${slices.map(s => `${s.label} ${fmt(s.value)}`).join(', ')}">
         <g transform="rotate(-90 60 60)">${arcs.map(a => a.arc)}</g>
         <text x="60" y="58" text-anchor="middle" class="r-chart-pie__total">${fmt(total)}</text>
         <text x="60" y="72" text-anchor="middle" class="r-chart-pie__caption">total</text>
      </svg>
      <ul class="r-chart-legend">
         ${arcs.map(a => html`<li><svg width="10" height="10" aria-hidden="true" focusable="false"><rect class="${a.cls}" width="10" height="10" rx="2"/></svg>
            <span class="r-chart-legend__label">${a.p.label}</span>
            <span class="r-chart-legend__value">${fmt(a.p.value)} · ${Math.round(a.share)}%</span></li>`)}
      </ul>
   </div>`;
}
