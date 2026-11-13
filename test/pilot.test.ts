import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, formFields, links, setupPilotEnv, type Env } from './helpers.ts';

// Pilot: "Demo Permintaan Barang" ported from APEX (examples/demo-permintaan). The business rules live in the
// ported PL/pgSQL packages and triggers; these tests drive them through the pages, as the users would.
let env: Env;
before(async () => { env = await setupPilotEnv(); });
after(async () => { await env?.close(); });

const q = async (sql: string, params: unknown[] = []) => (await env.pool.query(sql, params)).rows;
const request = async (purpose: string) => (await q('select * from apx_demo.apx_demo_requests where purpose = $1', [purpose]))[0];

async function as(user: string) {
   const b = new Browser(env);
   await b.login(user);
   return b;
}

/** Open a report and follow the row link whose text matches. */
async function openFrom(b: Browser, page: number, text: string) {
   const list = await b.open(`${env.base}/${page}`);
   const m = new RegExp(`class="r-cell-link" href="([^"]+)"[^>]*>${text}<`).exec(list.body);
   assert.ok(m, `link "${text}" on page ${page}`);
   return b.open(m[1].replace(/&amp;/g, '&'));
}

async function newRequest(b: Browser, purpose: string, dept = 'OPS') {
   const form = await b.open(`${env.base}/301?clear=301`);
   const deptId = String((await q(`select department_id from apx_demo.apx_demo_departments where dept_code = $1`, [dept]))[0].department_id);
   const r = await b.post(`${env.base}/301`, { ...formFields(form.body), P301_DEPARTMENT_ID: deptId, P301_PURPOSE: purpose, REQUEST: 'CREATE' });
   assert.equal(r.statusCode, 303, r.body.slice(0, 600));
   return request(purpose);
}

async function addLine(b: Browser, requestId: string, itemCode: string, qty: string) {
   const form = await b.open(`${env.base}/311?clear=311`);
   const item = (await q(`select item_id, std_price from apx_demo.apx_demo_items where item_code = $1`, [itemCode]))[0];
   const r = await b.post(`${env.base}/311`, {
      ...formFields(form.body), P311_REQUEST_ID: requestId, P311_ITEM_ID: String(item.item_id), P311_QTY: qty, P311_UNIT_PRICE: String(item.std_price), REQUEST: 'CREATE',
   });
   assert.equal(r.statusCode, 303, r.body.slice(0, 600));
}

async function submit(b: Browser, requestNo: string) {
   const form = await openFrom(b, 300, requestNo);
   return b.post(`${env.base}/301`, { ...formFields(form.body), REQUEST: 'SUBMIT' });
}

describe('pilot DEMO: access by role', () => {
   test('every page opens for admin; a user without a role is refused by the application scheme', async () => {
      const admin = await as('admin');
      for (const n of [100, 190, 200, 210, 300, 302, 310, 400, 500, 510]) {
         assert.equal((await admin.open(`${env.base}/${n}`)).statusCode, 200, `page ${n}`);
      }
      const tamu = await as('tamu');
      const r = await tamu.open(`${env.base}/100`);
      assert.equal(r.statusCode, 403);
      assert.match(r.body, /akun Anda belum didaftarkan di aplikasi ini/);
   });

   test('menus and buttons follow the roles (Administration for ADMIN, Create item for WAREHOUSE)', async () => {
      const budi = await as('budi');
      const home = await budi.open(`${env.base}/100`);
      assert.doesNotMatch(home.body, />Administration</);
      assert.equal((await budi.open(`${env.base}/500`)).statusCode, 403);
      assert.doesNotMatch((await budi.open(`${env.base}/210`)).body, />Create</, 'master data is for WAREHOUSE');
      const gudang = await as('gudang');
      assert.match((await gudang.open(`${env.base}/210`)).body, />Create</);
      assert.equal((await gudang.open(`${env.base}/301`)).statusCode, 403, 'WAREHOUSE is not a requester');
   });
});

describe('pilot DEMO: request -> approval (2 levels) -> fulfilled', () => {
   test('numbering, lines, submit, read-only after submit, manager then director', async () => {
      const budi = await as('budi');
      const req = await newRequest(budi, 'Laptop untuk tim gudang', 'IT');
      assert.match(req.request_no, /^REQ-\d{4}-\d{4}$/);
      assert.equal(req.status, 'DRAFT');
      assert.equal(req.created_by, 'BUDI', 'audit trigger sees the logged-in user');

      // submitting without lines is refused by the request package
      const empty = await submit(budi, req.request_no);
      assert.equal(empty.statusCode, 422);
      assert.match(empty.body, /Permintaan belum memiliki baris item\./);
      assert.equal((await request('Laptop untuk tim gudang')).status, 'DRAFT', 'rolled back');

      await addLine(budi, String(req.request_id), 'IT-001', '1');
      await addLine(budi, String(req.request_id), 'IT-002', '1');
      assert.equal((await submit(budi, req.request_no)).statusCode, 303);
      assert.equal((await request('Laptop untuk tim gudang')).status, 'SUBMITTED');

      // locked: fields shown as text, no Apply Changes / Submit, a crafted change is ignored
      const locked = await openFrom(budi, 300, req.request_no);
      assert.match(locked.body, /<span class="r-label">Keperluan<\/span><div class="r-display" id="P301_PURPOSE">Laptop untuk tim gudang<\/div>/);
      assert.match(locked.body, /id="P301_DEPARTMENT_ID">IT - Information Technology</);
      assert.doesNotMatch(locked.body, /value="SAVE"|value="SUBMIT"/);

      // manager: level 1 (12.65 jt > 10 jt limit, so a director step follows)
      const sari = await as('sari');
      const inbox = await sari.open(`${env.base}/190`);
      assert.match(inbox.body, new RegExp(`>${req.request_no}<`));
      const appr = await openFrom(sari, 190, req.request_no);
      assert.match(appr.body, /value="APPROVE"/);
      assert.equal((await sari.post(`${env.base}/191`, { ...formFields(appr.body), P191_NOTE: 'ok', REQUEST: 'APPROVE' })).statusCode, 303);
      let steps = await q(`select approval_level, approver_role, status from apx_demo.apx_demo_approvals where doc_id = $1 order by approval_level`, [req.request_id]);
      assert.deepEqual(steps, [
         { approval_level: 1, approver_role: 'MANAGER', status: 'APPROVED' },
         { approval_level: 2, approver_role: 'DIRECTOR', status: 'PENDING' },
      ]);

      // the manager cannot take the director's step: no button, and a crafted POST is refused
      const lvl2 = await sari.open((await sari.open(`${env.base}/190`)).body.match(new RegExp(`href="([^"]+)"[^>]*>${req.request_no}<`))![1].replace(/&amp;/g, '&'));
      assert.doesNotMatch(lvl2.body, /value="APPROVE"/);
      assert.equal((await sari.post(`${env.base}/191`, { ...formFields(lvl2.body), REQUEST: 'APPROVE' })).statusCode, 400);

      const dodi = await as('dodi');
      const step2 = await openFrom(dodi, 190, req.request_no);
      assert.equal((await dodi.post(`${env.base}/191`, { ...formFields(step2.body), REQUEST: 'APPROVE' })).statusCode, 303);
      assert.equal((await request('Laptop untuk tim gudang')).status, 'APPROVED');

      // after approval only the status may change (APPROVED -> FULFILLED); the purpose stays locked
      const approved = await openFrom(budi, 300, req.request_no);
      assert.match(approved.body, /<select class="r-input" id="P301_STATUS" name="P301_STATUS"/);
      const r = await budi.post(`${env.base}/301`, { ...formFields(approved.body), P301_STATUS: 'FULFILLED', P301_PURPOSE: 'diubah diam-diam', REQUEST: 'SAVE' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 600));
      const done = await request('Laptop untuk tim gudang');
      assert.equal(done.status, 'FULFILLED');
      assert.equal(done.updated_by, 'BUDI');
   });

   test('maker-checker: a manager cannot approve her own request', async () => {
      const sari = await as('sari');
      const req = await newRequest(sari, 'ATK ruang rapat');
      await addLine(sari, String(req.request_id), 'ATK-001', '2');
      assert.equal((await submit(sari, req.request_no)).statusCode, 303);
      const own = await openFrom(sari, 190, req.request_no);
      assert.match(own.body, /id="P191_CAN_ACT_YN">N</);
      assert.doesNotMatch(own.body, /value="APPROVE"|value="REJECT"/);
   });

   test('reject needs a reason; a rejected request can be edited and submitted again', async () => {
      const budi = await as('budi');
      const req = await newRequest(budi, 'Toner printer lantai 2');
      await addLine(budi, String(req.request_id), 'CON-001', '2');
      assert.equal((await submit(budi, req.request_no)).statusCode, 303);

      const sari = await as('sari');
      const form = await openFrom(sari, 190, req.request_no);
      const noReason = await sari.post(`${env.base}/191`, { ...formFields(form.body), P191_NOTE: '', REQUEST: 'REJECT' });
      assert.equal(noReason.statusCode, 422);
      assert.match(noReason.body, /Penolakan gagal/);
      assert.match(noReason.body, /Alasan penolakan wajib diisi\./);
      const again = await openFrom(sari, 190, req.request_no);
      assert.equal((await sari.post(`${env.base}/191`, { ...formFields(again.body), P191_NOTE: 'cukup 1', REQUEST: 'REJECT' })).statusCode, 303);
      assert.equal((await request('Toner printer lantai 2')).status, 'REJECTED');

      const edit = await openFrom(budi, 300, req.request_no);
      assert.match(edit.body, /<input class="r-input" type="text" id="P301_PURPOSE"/, 'editable again');
      assert.equal((await budi.post(`${env.base}/301`, { ...formFields(edit.body), P301_PURPOSE: 'Toner printer lantai 2 (1 pcs)', REQUEST: 'SUBMIT' })).statusCode, 303);
      const resubmitted = await request('Toner printer lantai 2 (1 pcs)');
      assert.equal(resubmitted.status, 'SUBMITTED');
   });

   test('lines of a submitted request cannot be changed', async () => {
      const budi = await as('budi');
      const sub = (await q(`select request_id from apx_demo.apx_demo_requests where status = 'SUBMITTED' limit 1`))[0];
      const line = (await q(`select line_id, qty from apx_demo.apx_demo_request_lines where request_id = $1 limit 1`, [sub.request_id]))[0];
      const list = await budi.open(`${env.base}/310`);
      const href = links(list.body).find(h => h.includes('P311_LINE_ID=' + line.line_id))!;
      const form = await budi.open(href);
      const r = await budi.post(`${env.base}/311`, { ...formFields(form.body), P311_QTY: '99', REQUEST: 'SAVE' });
      assert.equal(r.statusCode, 422);
      // the request is not in the list of DRAFT/REJECTED requests any more, so the form refuses before the trigger does
      assert.match(r.body, /No\. Permintaan: pilihan &quot;\d+&quot; tidak ada di daftar\.|tidak dapat diubah karena Permintaan Barang berstatus SUBMITTED/);
      assert.equal(String((await q(`select qty from apx_demo.apx_demo_request_lines where line_id = $1`, [line.line_id]))[0].qty), String(line.qty));
   });
});

describe('pilot DEMO: home, master-detail, admin', () => {
   test('report default sort (approval inbox: newest first) until the user sorts', async () => {
      const admin = await as('admin');
      const ids = (await q(`select doc_no from apx_demo.apx_demo_approvals order by approval_id desc`)).map(r => r.doc_no);
      const body = (await admin.open(`${env.base}/190`)).body;
      const shown = [...body.matchAll(/class="r-cell-link" href="[^"]+"[^>]*>(REQ-[^<]+)</g)].map(m => m[1]);
      assert.deepEqual(shown, ids);
      // a default sort on a visible column shows as a normal sort
      assert.match((await admin.open(`${env.base}/300`)).body, /aria-sort="ascending"[^>]*>.*?No\. Permintaan Barang/s);
   });

   test('home: KPI and both charts, with a table view', async () => {
      const sari = await as('sari');
      const home = await sari.open(`${env.base}/100`);
      assert.match(home.body, /<ul class="r-chart-bars" aria-label="Nilai per Department">/);
      assert.match(home.body, /<svg class="r-chart-pie__donut" viewBox="0 0 120 120" role="img" aria-label="Permintaan per Status: /);
      assert.match(home.body, /Tampilkan sebagai tabel/);
      assert.doesNotMatch(home.body, /Baris 1–1/, 'a one-page report shows no pager');
   });

   test('master-detail page 302: header and lines of the chosen request', async () => {
      const budi = await as('budi');
      const list = await budi.open(`${env.base}/302`);
      assert.match(list.body, /Pilih Permintaan Barang di daftar kiri/);
      const first = (await q(`select request_id, request_no from apx_demo.apx_demo_requests where status = 'DRAFT' order by request_no limit 1`))[0];
      const href = links(list.body).find(h => h.includes(`P302_REQUEST_ID=${first.request_id}`))!;
      const detail = await budi.open(href);
      assert.match(detail.body, new RegExp(`<td>${first.request_no}</td>`));
      assert.match(detail.body, /Baris Permintaan/);
      assert.match(detail.body, /value="CREATE_REQUEST_LINES"|>Tambah baris</, 'a draft can get lines');
      assert.doesNotMatch(detail.body, /Pilih Permintaan Barang di daftar kiri/);
   });

   test('admin grants a role; the new role applies on the next page view', async () => {
      const admin = await as('admin');
      const tamu = await as('tamu');
      assert.equal((await tamu.open(`${env.base}/100`)).statusCode, 403);
      const form = await admin.open(`${env.base}/501?clear=501`);
      assert.equal(formFields(form.body).P501_USERNAME, 'ADMIN', 'default: the current user');
      const r = await admin.post(`${env.base}/501`, { ...formFields(form.body), P501_USERNAME: 'tamu', P501_ROLE_CODE: 'REQUESTER', REQUEST: 'CREATE' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 500));
      assert.equal((await q(`select username from apx_demo.apx_demo_user_roles where role_code = 'REQUESTER' and username = 'TAMU'`)).length, 1);
      assert.equal((await tamu.open(`${env.base}/100`)).statusCode, 200);
   });
});
