import { strToU8, zipSync } from 'fflate';

// CSV and XLSX downloads for reports. No spreadsheet library: XLSX is a zip of a few small XML parts.

export interface ExportColumn { name: string; label: string; numeric: boolean }

/** CSV for Excel: UTF-8 BOM, comma separated, CRLF; cells that a spreadsheet would run as a formula are neutralised. */
export function toCsv(cols: ExportColumn[], rows: (string | null)[][]): Buffer {
   const cell = (v: string | null) => {
      let s = v ?? '';
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // CSV/formula injection
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
   };
   const lines = [cols.map(c => cell(c.label)).join(','), ...rows.map(r => r.map(cell).join(','))];
   return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

const xml = (s: string) => s
   .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')       // not allowed in XML 1.0
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colRef(i: number): string {
   let s = '';
   for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
   return s;
}

/** XLSX with one sheet; numeric columns are real numbers, everything else inline text (never formulas). */
export function toXlsx(cols: ExportColumn[], rows: (string | null)[][], sheetName = 'Data'): Buffer {
   const cellXml = (v: string | null, ci: number, ri: number, header: boolean) => {
      const ref = `${colRef(ci)}${ri}`;
      if (v === null || v === '') return '';
      if (!header && cols[ci].numeric && /^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
   };
   const sheetRows = [cols.map(c => c.label), ...rows].map((r, i) =>
      `<row r="${i + 1}">${r.map((v, ci) => cellXml(v, ci, i + 1, i === 0)).join('')}</row>`).join('');
   const files: Record<string, string> = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`,
   };
   const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
   return Buffer.from(zipped);
}
